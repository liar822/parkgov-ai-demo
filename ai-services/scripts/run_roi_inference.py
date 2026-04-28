#!/usr/bin/env python3
"""Run ROI-based parking-slot occupancy inference for image or short video input.

This script is the automatic inference bridge for the MVP demo:
image/video + ROI JSON + trained slot classifier -> backend-compatible
standard inference JSON.
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import numpy as np
import torch
from PIL import Image, ImageOps

SCRIPT_DIR = Path(__file__).resolve().parent
AI_ROOT = SCRIPT_DIR.parent
PROJECT_ROOT = SCRIPT_DIR.parents[3]
sys.path.insert(0, str(SCRIPT_DIR))

from train_acpds_slot_classifier import (  # noqa: E402
    SlotOccupancyCNN,
    choose_device,
    normalize_batch,
)


def read_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def resolve_path(value: str | None, *, base: Path | None = None) -> Path | None:
    if not value:
        return None

    raw = Path(value).expanduser()
    candidates = []
    if raw.is_absolute():
        candidates.append(raw)
    else:
        if base:
            candidates.append((base / raw).resolve())
        candidates.extend([
            (Path.cwd() / raw).resolve(),
            (AI_ROOT / raw).resolve(),
            (PROJECT_ROOT / raw).resolve(),
        ])

    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0] if candidates else raw


def split_archive_fragment(path_spec: str) -> Tuple[str, str | None]:
    if "#" not in path_spec:
        return path_spec, None
    archive_path, inner_path = path_spec.split("#", 1)
    return archive_path, inner_path


def resolve_input_spec(input_spec: str, *, base: Path | None = None) -> Tuple[Path, str | None]:
    file_part, inner_part = split_archive_fragment(input_spec)
    resolved = resolve_path(file_part, base=base)
    if resolved is None:
        raise ValueError("Input path is required.")
    return resolved, inner_part


def load_image_from_spec(input_spec: str, *, base: Path | None = None) -> Image.Image:
    input_path, inner_path = resolve_input_spec(input_spec, base=base)
    if not input_path.exists():
        raise FileNotFoundError(f"Input image/archive not found: {input_path}")

    if inner_path:
        with zipfile.ZipFile(input_path) as archive:
            with archive.open(inner_path) as image_handle:
                image = Image.open(BytesIO(image_handle.read()))
                image.load()
                return ImageOps.exif_transpose(image).convert("RGB")

    image = Image.open(input_path)
    image.load()
    return ImageOps.exif_transpose(image).convert("RGB")


def load_model(checkpoint_path: Path, device: torch.device) -> Tuple[SlotOccupancyCNN, Dict[str, Any]]:
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"Model checkpoint not found: {checkpoint_path}")

    checkpoint = torch.load(checkpoint_path, map_location=device)
    model = SlotOccupancyCNN().to(device)
    state_dict = checkpoint.get("model_state_dict", checkpoint)
    model.load_state_dict(state_dict)
    model.eval()
    return model, checkpoint


def roi_bbox(roi: Dict[str, Any], image_width: int, image_height: int, padding: float) -> Tuple[int, int, int, int]:
    coordinate_space = str(roi.get("coordinate_space") or "pixel").lower()
    x = float(roi["x"])
    y = float(roi["y"])
    width = float(roi["width"])
    height = float(roi["height"])

    if coordinate_space in {"normalized", "relative", "ratio"}:
        x *= image_width
        width *= image_width
        y *= image_height
        height *= image_height

    pad_x = max(1.0, width * padding)
    pad_y = max(1.0, height * padding)
    left = max(0, int(round(x - pad_x)))
    top = max(0, int(round(y - pad_y)))
    right = min(image_width, int(round(x + width + pad_x)))
    bottom = min(image_height, int(round(y + height + pad_y)))

    if right <= left or bottom <= top:
        raise ValueError(f"Invalid ROI bbox for slot {roi.get('slot_number')}: {roi}")

    return left, top, right, bottom


def crop_patch(image: Image.Image, roi: Dict[str, Any], image_size: int, padding: float) -> torch.Tensor:
    image = ImageOps.exif_transpose(image).convert("RGB")
    bbox = roi_bbox(roi, image.width, image.height, padding)
    patch = image.crop(bbox).resize((image_size, image_size), Image.Resampling.BILINEAR)
    array = np.asarray(patch, dtype=np.uint8).copy()
    return torch.from_numpy(array).permute(2, 0, 1).contiguous()


@torch.no_grad()
def predict_rois(
    model: SlotOccupancyCNN,
    image: Image.Image,
    rois: List[Dict[str, Any]],
    *,
    image_size: int,
    padding: float,
    device: torch.device,
    threshold: float,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    predictions: List[Dict[str, Any]] = []
    failures: List[Dict[str, Any]] = []

    for roi in rois:
        try:
            patch = crop_patch(image, roi, image_size, padding).unsqueeze(0)
            logits = model(normalize_batch(patch, device))
            probabilities = logits.softmax(dim=1).detach().cpu()[0]
            occupied_probability = float(probabilities[1])
            is_occupied = occupied_probability >= threshold
            confidence = occupied_probability if is_occupied else 1.0 - occupied_probability
            predictions.append({
                "slot_id": roi.get("slot_id"),
                "slot_number": roi.get("slot_number"),
                "is_occupied": bool(is_occupied),
                "confidence": round(float(confidence), 4),
                "occupied_probability": round(float(occupied_probability), 6),
                "predicted_vacancy_seconds": 0,
            })
        except Exception as error:  # noqa: BLE001
            failures.append({
                "slot_id": roi.get("slot_id"),
                "slot_number": roi.get("slot_number"),
                "error": str(error),
            })

    return predictions, failures


def load_video_frames(input_spec: str, *, base: Path | None, sample_every: int, max_frames: int) -> List[Image.Image]:
    try:
        import cv2  # type: ignore
    except ImportError as error:
        raise RuntimeError("OpenCV is required for video inference. Install opencv-python in ai-services/.venv.") from error

    input_path, inner_path = resolve_input_spec(input_spec, base=base)
    if inner_path:
        raise ValueError("Video input from inside a zip archive is not supported.")
    if not input_path.exists():
        raise FileNotFoundError(f"Video input not found: {input_path}")

    capture = cv2.VideoCapture(str(input_path))
    if not capture.isOpened():
        raise RuntimeError(f"Unable to open video input: {input_path}")

    frames: List[Image.Image] = []
    frame_index = 0
    interval = max(1, int(sample_every))
    limit = max(1, int(max_frames))

    try:
        while len(frames) < limit:
            ok, frame = capture.read()
            if not ok:
                break
            if frame_index % interval == 0:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                frames.append(Image.fromarray(rgb).convert("RGB"))
            frame_index += 1
    finally:
        capture.release()

    if not frames:
        raise RuntimeError(f"No frames were sampled from video input: {input_path}")
    return frames


def aggregate_video_predictions(frame_predictions: List[List[Dict[str, Any]]], rois: List[Dict[str, Any]], threshold: float) -> List[Dict[str, Any]]:
    by_slot: Dict[str, List[float]] = {}
    roi_lookup: Dict[str, Dict[str, Any]] = {}

    for roi in rois:
        key = str(roi.get("slot_id") or roi.get("slot_number"))
        by_slot[key] = []
        roi_lookup[key] = roi

    for predictions in frame_predictions:
        for prediction in predictions:
            key = str(prediction.get("slot_id") or prediction.get("slot_number"))
            if key in by_slot:
                by_slot[key].append(float(prediction.get("occupied_probability", 0.0)))

    aggregated: List[Dict[str, Any]] = []
    for key, probabilities in by_slot.items():
        roi = roi_lookup[key]
        occupied_probability = sum(probabilities) / len(probabilities) if probabilities else 0.0
        is_occupied = occupied_probability >= threshold
        confidence = occupied_probability if is_occupied else 1.0 - occupied_probability
        aggregated.append({
            "slot_id": roi.get("slot_id"),
            "slot_number": roi.get("slot_number"),
            "is_occupied": bool(is_occupied),
            "confidence": round(float(confidence), 4),
            "occupied_probability": round(float(occupied_probability), 6),
            "predicted_vacancy_seconds": 0,
        })

    return aggregated


def build_output(
    *,
    config: Dict[str, Any],
    detections: List[Dict[str, Any]],
    failures: List[Dict[str, Any]],
    frames_evaluated: int,
    mode: str,
    input_path: str,
) -> Dict[str, Any]:
    occupied = sum(1 for detection in detections if detection["is_occupied"])
    total = len(detections)
    confidence_values = [float(detection["confidence"]) for detection in detections if detection.get("confidence") is not None]
    average_confidence = sum(confidence_values) / len(confidence_values) if confidence_values else None

    return {
        "camera_external_id": config.get("camera_external_id"),
        "parking_lot_source_id": config.get("parking_lot_source_id"),
        "model_name": config.get("model_name") or "roi_slot_classifier",
        "input_path": input_path,
        "inference_timestamp": datetime.now().isoformat(timespec="seconds"),
        "notes": config.get("notes") or "ROI model inference demo; not a live camera feed.",
        "detections": [
            {
                "slot_id": detection.get("slot_id"),
                "slot_number": detection.get("slot_number"),
                "is_occupied": detection["is_occupied"],
                "confidence": detection["confidence"],
                "predicted_vacancy_seconds": detection.get("predicted_vacancy_seconds", 0),
            }
            for detection in detections
        ],
        "summary": {
            "total_slots": total,
            "occupied_count": occupied,
            "vacant_count": total - occupied,
            "average_confidence": round(float(average_confidence), 4) if average_confidence is not None else None,
            "failed_roi_count": len(failures),
        },
        "diagnostics": {
            "mode": mode,
            "roi_count": total + len(failures),
            "frames_evaluated": frames_evaluated,
            "threshold": float(config.get("threshold", 0.5)),
            "input_path": input_path,
            "checkpoint_path": config.get("checkpoint_path"),
            "roi_version": config.get("roi_version"),
            "failures": failures[:20],
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run ROI parking-slot inference and print backend-compatible JSON.")
    parser.add_argument("--config", required=True, help="Path to demo inference config JSON.")
    parser.add_argument("--roi-json", required=True, help="Path to ROI JSON exported by backend.")
    parser.add_argument("--input", dest="input_path", help="Override input image/video path.")
    parser.add_argument("--checkpoint", dest="checkpoint_path", help="Override model checkpoint path.")
    parser.add_argument("--mode", choices=["image", "video"], help="Override inference mode.")
    parser.add_argument("--model-name", help="Override model name.")
    parser.add_argument("--threshold", type=float, help="Override occupied probability threshold.")
    parser.add_argument("--device", help="Override torch device: cpu, mps, cuda, or auto.")
    parser.add_argument("--sample-every", type=int, help="Video frame sampling interval in frames.")
    parser.add_argument("--max-frames", type=int, help="Maximum sampled frames for video inference.")
    parser.add_argument("--dry-run", action="store_true", help="Validate config and ROI input without loading the model.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config_path = resolve_path(args.config)
    roi_path = resolve_path(args.roi_json)
    if config_path is None or not config_path.exists():
        raise FileNotFoundError(f"Config not found: {args.config}")
    if roi_path is None or not roi_path.exists():
        raise FileNotFoundError(f"ROI JSON not found: {args.roi_json}")

    config = read_json(config_path)
    roi_payload = read_json(roi_path)
    rois = roi_payload.get("rois") or []
    if not rois:
        raise ValueError("ROI JSON does not contain any rois.")

    if args.input_path:
        config["input_path"] = args.input_path
    if args.checkpoint_path:
        config["checkpoint_path"] = args.checkpoint_path
    if args.mode:
        config["mode"] = args.mode
    if args.model_name:
        config["model_name"] = args.model_name
    if args.threshold is not None:
        config["threshold"] = args.threshold
    if args.device:
        config["device"] = args.device
    if args.sample_every:
        config["sample_every_frames"] = args.sample_every
    if args.max_frames:
        config["max_frames"] = args.max_frames

    input_spec = str(config.get("input_path") or "")
    checkpoint_path = resolve_path(str(config.get("checkpoint_path") or ""), base=config_path.parent)
    mode = str(config.get("mode") or "image").lower()
    threshold = float(config.get("threshold", 0.5))
    image_size = int(config.get("image_size", 96))
    padding = float(config.get("padding", 0.12))

    if args.dry_run:
        input_file, input_fragment = resolve_input_spec(input_spec, base=config_path.parent)
        output = {
            "dry_run": True,
            "config": str(config_path),
            "roi_json": str(roi_path),
            "input_path": f"{input_file}#{input_fragment}" if input_fragment else str(input_file),
            "checkpoint_path": str(checkpoint_path),
            "mode": mode,
            "roi_count": len(rois),
            "would_generate_standard_inference_json": True,
            "notes": "Dry run only; model inference was not executed.",
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0

    if checkpoint_path is None:
        raise ValueError("checkpoint_path is required.")
    device = choose_device(str(config.get("device") or "cpu"))
    model, checkpoint = load_model(checkpoint_path, device)
    image_size = int(config.get("image_size") or checkpoint.get("image_size", image_size))
    padding = float(config.get("padding") if config.get("padding") is not None else checkpoint.get("padding", padding))

    failures: List[Dict[str, Any]] = []
    frames_evaluated = 1

    if mode == "image":
        image = load_image_from_spec(input_spec, base=config_path.parent)
        detections, failures = predict_rois(
            model,
            image,
            rois,
            image_size=image_size,
            padding=padding,
            device=device,
            threshold=threshold,
        )
    elif mode == "video":
        frames = load_video_frames(
            input_spec,
            base=config_path.parent,
            sample_every=int(config.get("sample_every_frames", 30)),
            max_frames=int(config.get("max_frames", 8)),
        )
        frames_evaluated = len(frames)
        frame_predictions: List[List[Dict[str, Any]]] = []
        for frame in frames:
            predictions, frame_failures = predict_rois(
                model,
                frame,
                rois,
                image_size=image_size,
                padding=padding,
                device=device,
                threshold=threshold,
            )
            frame_predictions.append(predictions)
            failures.extend(frame_failures)
        detections = aggregate_video_predictions(frame_predictions, rois, threshold)
    else:
        raise ValueError(f"Unsupported mode: {mode}")

    output = build_output(
        config=config,
        detections=detections,
        failures=failures,
        frames_evaluated=frames_evaluated,
        mode=mode,
        input_path=input_spec,
    )
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(json.dumps({
            "success": False,
            "error": str(error),
            "hint": "Check model checkpoint, input file, ROI JSON, Python environment, and database-seeded ROI rows.",
        }, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
