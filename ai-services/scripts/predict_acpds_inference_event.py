#!/usr/bin/env python3
"""Generate a standard inference event from an ACPDS image.

The output JSON is compatible with the backend:
POST /api/admin/inference-events
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import zipfile
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import torch
from PIL import Image, ImageOps

from train_acpds_slot_classifier import (
    SlotOccupancyCNN,
    choose_device,
    crop_slot_patch,
    normalize_batch,
    roi_to_bbox,
)


def load_annotations(archive: zipfile.ZipFile) -> Dict[str, Any]:
    with archive.open("annotations.json") as handle:
        annotations = json.load(handle)
    if not isinstance(annotations, dict):
        raise ValueError("annotations.json must be an object keyed by split")
    return annotations


def load_model(checkpoint_path: Path, device: torch.device) -> Tuple[SlotOccupancyCNN, Dict[str, Any]]:
    checkpoint = torch.load(checkpoint_path, map_location=device)
    model = SlotOccupancyCNN().to(device)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    return model, checkpoint


def predict_slot(
    model: SlotOccupancyCNN,
    image: Image.Image,
    roi: Iterable[Iterable[float]],
    image_size: int,
    padding: float,
    device: torch.device,
    threshold: float,
) -> Dict[str, Any]:
    patch = crop_slot_patch(image, roi, image_size, padding).unsqueeze(0)
    with torch.no_grad():
        logits = model(normalize_batch(patch, device))
        probabilities = logits.softmax(dim=1).detach().cpu()[0]

    occupied_probability = float(probabilities[1])
    is_occupied = occupied_probability >= threshold
    confidence = occupied_probability if is_occupied else 1.0 - occupied_probability

    return {
        "is_occupied": is_occupied,
        "confidence": round(confidence, 4),
        "occupied_probability": occupied_probability,
    }


def summarize_predictions(predictions: List[Dict[str, Any]], labels: List[bool]) -> Dict[str, Any]:
    predicted = [bool(item["is_occupied"]) for item in predictions]
    truth = [bool(label) for label in labels]
    tp = sum(1 for pred, label in zip(predicted, truth) if pred and label)
    tn = sum(1 for pred, label in zip(predicted, truth) if not pred and not label)
    fp = sum(1 for pred, label in zip(predicted, truth) if pred and not label)
    fn = sum(1 for pred, label in zip(predicted, truth) if not pred and label)
    total = len(truth)

    return {
        "slot_count": total,
        "predicted_occupied": sum(predicted),
        "predicted_vacant": total - sum(predicted),
        "ground_truth_occupied": sum(truth),
        "ground_truth_vacant": total - sum(truth),
        "image_accuracy": round((tp + tn) / total, 4) if total else 0,
        "confusion_matrix": {
            "tn": tn,
            "fp": fp,
            "fn": fn,
            "tp": tp,
        },
    }


def write_roi_csv(
    path: Path,
    parking_lot_source_id: str,
    parking_lot_name: str,
    camera_external_id: str,
    image: Image.Image,
    rois: List[Any],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    width, height = ImageOps.exif_transpose(image).size
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "parking_lot_source_id",
                "parking_lot_name",
                "camera_id",
                "slot_number",
                "x",
                "y",
                "width",
                "height",
                "coordinate_space",
                "frame_width",
                "frame_height",
                "notes",
            ],
        )
        writer.writeheader()
        for index, roi in enumerate(rois, start=1):
            left, top, right, bottom = roi_to_bbox(roi, width, height, padding=0.0)
            writer.writerow(
                {
                    "parking_lot_source_id": parking_lot_source_id,
                    "parking_lot_name": parking_lot_name,
                    "camera_id": camera_external_id,
                    "slot_number": index,
                    "x": left,
                    "y": top,
                    "width": max(1, right - left),
                    "height": max(1, bottom - top),
                    "coordinate_space": "pixel",
                    "frame_width": width,
                    "frame_height": height,
                    "notes": "ACPDS公开数据集ROI：用于模型验证和平台写回演示",
                }
            )


def main() -> int:
    parser = argparse.ArgumentParser(description="Predict ACPDS image and output backend inference JSON")
    parser.add_argument("--zip", default="../../../datasets/raw/acpds/rois_gopro.zip")
    parser.add_argument("--checkpoint", default="training_runs/acpds_first_round/acpds_slot_cnn_best.pt")
    parser.add_argument("--split", default="test")
    parser.add_argument("--image-index", type=int, default=2)
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--parking-lot-source-id", default="ACPDS_PUBLIC_DATASET_DEMO_001")
    parser.add_argument("--parking-lot-name", default="ACPDS公开数据集验证停车场")
    parser.add_argument("--camera-external-id", default="CAMERA_ACPDS_DEMO_001")
    parser.add_argument("--model-name", default="acpds_slot_cnn_first_round")
    parser.add_argument("--output-json", default="../../../data/acpds_first_round_inference_event_demo.json")
    parser.add_argument("--output-roi-csv", default="../../../data/acpds_public_dataset_slot_roi_demo.csv")
    args = parser.parse_args()

    zip_path = Path(args.zip).expanduser().resolve()
    checkpoint_path = Path(args.checkpoint).expanduser().resolve()
    output_json = Path(args.output_json).expanduser().resolve()
    output_roi_csv = Path(args.output_roi_csv).expanduser().resolve() if args.output_roi_csv else None
    device = choose_device(args.device)

    if not zip_path.exists():
        print(f"ACPDS archive not found: {zip_path}", file=sys.stderr)
        return 1
    if not checkpoint_path.exists():
        print(f"Checkpoint not found: {checkpoint_path}", file=sys.stderr)
        return 1

    model, checkpoint = load_model(checkpoint_path, device)
    image_size = int(checkpoint.get("image_size", 96))
    padding = float(checkpoint.get("padding", 0.12))

    with zipfile.ZipFile(zip_path) as archive:
        annotations = load_annotations(archive)
        split_payload = annotations[args.split]
        file_names = split_payload["file_names"]
        if args.image_index < 0 or args.image_index >= len(file_names):
            raise IndexError(f"image-index must be between 0 and {len(file_names) - 1}")

        file_name = file_names[args.image_index]
        rois = split_payload["rois_list"][args.image_index]
        labels = split_payload["occupancy_list"][args.image_index]
        image_path = f"images/{file_name}"
        with archive.open(image_path) as image_handle:
            image = Image.open(BytesIO(image_handle.read()))
            image.load()
            image = ImageOps.exif_transpose(image).convert("RGB")

    predictions = [
        predict_slot(model, image, roi, image_size, padding, device, args.threshold)
        for roi in rois
    ]
    summary = summarize_predictions(predictions, labels)

    detections = []
    for index, prediction in enumerate(predictions, start=1):
        detections.append(
            {
                "slot_number": index,
                "is_occupied": prediction["is_occupied"],
                "confidence": prediction["confidence"],
                "predicted_vacancy_seconds": 0,
            }
        )

    payload = {
        "camera_external_id": args.camera_external_id,
        "parking_lot_source_id": args.parking_lot_source_id,
        "model_name": args.model_name,
        "input_path": f"{zip_path}#{image_path}",
        "inference_timestamp": datetime.now().isoformat(timespec="seconds"),
        "notes": (
            "ACPDS公开数据集测试图模型推理结果；仅用于验证训练模型到平台写回链路，"
            "不代表北京或校园真实摄像头接入。"
        ),
        "detections": detections,
    }

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if output_roi_csv:
        write_roi_csv(
            output_roi_csv,
            args.parking_lot_source_id,
            args.parking_lot_name,
            args.camera_external_id,
            image,
            rois,
        )

    print(json.dumps({
        "output_json": str(output_json),
        "output_roi_csv": str(output_roi_csv) if output_roi_csv else None,
        "split": args.split,
        "image_index": args.image_index,
        "image_file": file_name,
        "threshold": args.threshold,
        "summary": summary,
    }, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
