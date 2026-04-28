#!/usr/bin/env python3
"""Train a lightweight occupied/vacant parking-slot classifier on ACPDS.

This is the first training baseline for the challenge-cup prototype. It keeps
the scope deliberately small: crop each annotated slot ROI from ACPDS, train a
compact CNN, and report validation/test metrics that can later be written into
the platform's standard inference JSON.
"""

from __future__ import annotations

import argparse
import json
import random
import time
import zipfile
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import numpy as np
import torch
from PIL import Image, ImageOps
from torch import nn
from torch.utils.data import DataLoader, TensorDataset


@dataclass
class SplitTensors:
    name: str
    images: torch.Tensor
    labels: torch.Tensor
    image_count: int
    slot_instances: int


class SlotOccupancyCNN(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 16, kernel_size=3, padding=1),
            nn.BatchNorm2d(16),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(16, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(64, 128, kernel_size=3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d((1, 1)),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(0.25),
            nn.Linear(128, 2),
        )

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.classifier(self.features(inputs))


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def choose_device(requested: str) -> torch.device:
    if requested != "auto":
        return torch.device(requested)
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def load_annotations(archive: zipfile.ZipFile) -> Dict[str, Any]:
    with archive.open("annotations.json") as handle:
        annotations = json.load(handle)
    if not isinstance(annotations, dict):
        raise ValueError("annotations.json must be an object keyed by split")
    return annotations


def roi_to_bbox(roi: Iterable[Iterable[float]], width: int, height: int, padding: float) -> Tuple[int, int, int, int]:
    points = list(roi)
    xs = [float(point[0]) * width for point in points]
    ys = [float(point[1]) * height for point in points]

    left, right = min(xs), max(xs)
    top, bottom = min(ys), max(ys)
    pad_x = max(2.0, (right - left) * padding)
    pad_y = max(2.0, (bottom - top) * padding)

    return (
        max(0, int(left - pad_x)),
        max(0, int(top - pad_y)),
        min(width, int(right + pad_x)),
        min(height, int(bottom + pad_y)),
    )


def crop_slot_patch(image: Image.Image, roi: Iterable[Iterable[float]], image_size: int, padding: float) -> torch.Tensor:
    image = ImageOps.exif_transpose(image).convert("RGB")
    width, height = image.size
    bbox = roi_to_bbox(roi, width, height, padding)
    patch = image.crop(bbox).resize((image_size, image_size), Image.Resampling.BILINEAR)
    array = np.asarray(patch, dtype=np.uint8).copy()
    # Store as CHW uint8 to keep memory use modest; convert to float in batches.
    return torch.from_numpy(array).permute(2, 0, 1).contiguous()


def build_split_tensors(
    archive: zipfile.ZipFile,
    split_name: str,
    split_payload: Dict[str, Any],
    image_size: int,
    padding: float,
    max_samples: int | None = None,
) -> SplitTensors:
    patches: List[torch.Tensor] = []
    labels: List[int] = []
    file_names = split_payload.get("file_names", [])
    rois_list = split_payload.get("rois_list", [])
    occupancy_list = split_payload.get("occupancy_list", [])

    for file_index, file_name in enumerate(file_names):
        image_path = f"images/{file_name}"
        with archive.open(image_path) as image_handle:
            image = Image.open(BytesIO(image_handle.read()))
            image.load()

        rois = rois_list[file_index]
        occupancies = occupancy_list[file_index]
        for roi, is_occupied in zip(rois, occupancies):
            patches.append(crop_slot_patch(image, roi, image_size, padding))
            labels.append(1 if bool(is_occupied) else 0)
            if max_samples is not None and len(labels) >= max_samples:
                break
        if max_samples is not None and len(labels) >= max_samples:
            break

    if not patches:
        raise ValueError(f"No slot patches found for split: {split_name}")

    return SplitTensors(
        name=split_name,
        images=torch.stack(patches),
        labels=torch.tensor(labels, dtype=torch.long),
        image_count=len(file_names),
        slot_instances=len(labels),
    )


def normalize_batch(batch: torch.Tensor, device: torch.device) -> torch.Tensor:
    batch = batch.to(device=device, dtype=torch.float32).div_(255.0)
    mean = torch.tensor([0.485, 0.456, 0.406], device=device).view(1, 3, 1, 1)
    std = torch.tensor([0.229, 0.224, 0.225], device=device).view(1, 3, 1, 1)
    return (batch - mean) / std


def metrics_from_predictions(labels: torch.Tensor, predictions: torch.Tensor, probabilities: torch.Tensor) -> Dict[str, Any]:
    labels_np = labels.cpu().numpy()
    pred_np = predictions.cpu().numpy()
    prob_np = probabilities.cpu().numpy()

    tn = int(((labels_np == 0) & (pred_np == 0)).sum())
    fp = int(((labels_np == 0) & (pred_np == 1)).sum())
    fn = int(((labels_np == 1) & (pred_np == 0)).sum())
    tp = int(((labels_np == 1) & (pred_np == 1)).sum())
    total = len(labels_np)

    occupied_precision = tp / (tp + fp) if tp + fp else 0.0
    occupied_recall = tp / (tp + fn) if tp + fn else 0.0
    occupied_f1 = (
        2 * occupied_precision * occupied_recall / (occupied_precision + occupied_recall)
        if occupied_precision + occupied_recall
        else 0.0
    )
    vacant_precision = tn / (tn + fn) if tn + fn else 0.0
    vacant_recall = tn / (tn + fp) if tn + fp else 0.0
    vacant_f1 = (
        2 * vacant_precision * vacant_recall / (vacant_precision + vacant_recall)
        if vacant_precision + vacant_recall
        else 0.0
    )

    return {
        "accuracy": (tp + tn) / total if total else 0.0,
        "occupied": {
            "precision": occupied_precision,
            "recall": occupied_recall,
            "f1": occupied_f1,
        },
        "vacant": {
            "precision": vacant_precision,
            "recall": vacant_recall,
            "f1": vacant_f1,
        },
        "confusion_matrix": {
            "tn": tn,
            "fp": fp,
            "fn": fn,
            "tp": tp,
        },
        "mean_occupied_probability": float(prob_np[:, 1].mean()) if total else 0.0,
    }


@torch.no_grad()
def evaluate_model(model: nn.Module, split: SplitTensors, batch_size: int, device: torch.device) -> Dict[str, Any]:
    model.eval()
    loader = DataLoader(TensorDataset(split.images, split.labels), batch_size=batch_size, shuffle=False)
    all_labels: List[torch.Tensor] = []
    all_predictions: List[torch.Tensor] = []
    all_probabilities: List[torch.Tensor] = []
    loss_total = 0.0
    criterion = nn.CrossEntropyLoss(reduction="sum")

    for images, labels in loader:
        labels = labels.to(device)
        logits = model(normalize_batch(images, device))
        loss_total += float(criterion(logits, labels).detach().cpu())
        probabilities = logits.softmax(dim=1)
        predictions = probabilities.argmax(dim=1)

        all_labels.append(labels.cpu())
        all_predictions.append(predictions.cpu())
        all_probabilities.append(probabilities.cpu())

    labels_cat = torch.cat(all_labels)
    predictions_cat = torch.cat(all_predictions)
    probabilities_cat = torch.cat(all_probabilities)
    metrics = metrics_from_predictions(labels_cat, predictions_cat, probabilities_cat)
    metrics["loss"] = loss_total / len(split.labels)
    metrics["slot_instances"] = split.slot_instances
    return metrics


def train_one_epoch(
    model: nn.Module,
    train_split: SplitTensors,
    batch_size: int,
    device: torch.device,
    optimizer: torch.optim.Optimizer,
    class_weights: torch.Tensor,
) -> float:
    model.train()
    indices = torch.randperm(len(train_split.labels))
    images = train_split.images[indices]
    labels = train_split.labels[indices]
    loader = DataLoader(TensorDataset(images, labels), batch_size=batch_size, shuffle=True)
    criterion = nn.CrossEntropyLoss(weight=class_weights)
    loss_total = 0.0
    seen = 0

    for batch_images, batch_labels in loader:
        batch_labels = batch_labels.to(device)
        optimizer.zero_grad(set_to_none=True)
        logits = model(normalize_batch(batch_images, device))
        loss = criterion(logits, batch_labels)
        loss.backward()
        optimizer.step()

        batch_size_actual = len(batch_labels)
        loss_total += float(loss.detach().cpu()) * batch_size_actual
        seen += batch_size_actual

    return loss_total / seen if seen else 0.0


def format_metric(value: float) -> float:
    return round(float(value), 4)


def rounded_metrics(metrics: Dict[str, Any]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for key, value in metrics.items():
        if isinstance(value, float):
            result[key] = format_metric(value)
        elif isinstance(value, dict):
            result[key] = rounded_metrics(value)
        else:
            result[key] = value
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Train first-round ACPDS slot occupancy classifier")
    parser.add_argument("--zip", default="../../../datasets/raw/acpds/rois_gopro.zip")
    parser.add_argument("--output-dir", default="training_runs/acpds_first_round")
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--image-size", type=int, default=96)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--padding", type=float, default=0.12)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--max-train-samples", type=int)
    parser.add_argument("--max-valid-samples", type=int)
    parser.add_argument("--max-test-samples", type=int)
    args = parser.parse_args()

    set_seed(args.seed)
    device = choose_device(args.device)
    zip_path = Path(args.zip).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    started_at = datetime.now().isoformat(timespec="seconds")
    print(f"Loading ACPDS from {zip_path}")
    print(f"Using device: {device}")

    with zipfile.ZipFile(zip_path) as archive:
        annotations = load_annotations(archive)
        train_split = build_split_tensors(
            archive,
            "train",
            annotations["train"],
            args.image_size,
            args.padding,
            args.max_train_samples,
        )
        valid_split = build_split_tensors(
            archive,
            "valid",
            annotations["valid"],
            args.image_size,
            args.padding,
            args.max_valid_samples,
        )
        test_split = build_split_tensors(
            archive,
            "test",
            annotations["test"],
            args.image_size,
            args.padding,
            args.max_test_samples,
        )

    print(
        "Loaded splits: "
        f"train={train_split.slot_instances}, "
        f"valid={valid_split.slot_instances}, "
        f"test={test_split.slot_instances}"
    )

    model = SlotOccupancyCNN().to(device)
    label_counts = torch.bincount(train_split.labels, minlength=2).float()
    class_weights = (label_counts.sum() / (2 * label_counts)).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)

    history = []
    best_valid_accuracy = -1.0
    best_model_path = output_dir / "acpds_slot_cnn_best.pt"
    start_time = time.time()

    for epoch in range(1, args.epochs + 1):
        train_loss = train_one_epoch(model, train_split, args.batch_size, device, optimizer, class_weights)
        valid_metrics = evaluate_model(model, valid_split, args.batch_size, device)
        train_metrics = evaluate_model(model, train_split, args.batch_size, device)

        row = {
            "epoch": epoch,
            "train_loss": format_metric(train_loss),
            "train_accuracy": format_metric(train_metrics["accuracy"]),
            "valid_accuracy": format_metric(valid_metrics["accuracy"]),
            "valid_occupied_f1": format_metric(valid_metrics["occupied"]["f1"]),
            "valid_vacant_f1": format_metric(valid_metrics["vacant"]["f1"]),
        }
        history.append(row)
        print(json.dumps(row, ensure_ascii=False))

        if valid_metrics["accuracy"] > best_valid_accuracy:
            best_valid_accuracy = valid_metrics["accuracy"]
            torch.save(
                {
                    "model_state_dict": model.state_dict(),
                    "image_size": args.image_size,
                    "padding": args.padding,
                    "label_map": {"vacant": 0, "occupied": 1},
                    "created_at": datetime.now().isoformat(timespec="seconds"),
                },
                best_model_path,
            )

    checkpoint = torch.load(best_model_path, map_location=device)
    model.load_state_dict(checkpoint["model_state_dict"])
    valid_metrics = rounded_metrics(evaluate_model(model, valid_split, args.batch_size, device))
    test_metrics = rounded_metrics(evaluate_model(model, test_split, args.batch_size, device))
    train_metrics = rounded_metrics(evaluate_model(model, train_split, args.batch_size, device))

    summary = {
        "run_name": "acpds_first_round",
        "started_at": started_at,
        "finished_at": datetime.now().isoformat(timespec="seconds"),
        "duration_seconds": round(time.time() - start_time, 2),
        "dataset": {
            "name": "ACPDS",
            "archive": str(zip_path),
            "train_slot_instances": train_split.slot_instances,
            "valid_slot_instances": valid_split.slot_instances,
            "test_slot_instances": test_split.slot_instances,
        },
        "training": {
            "model": "SlotOccupancyCNN",
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "image_size": args.image_size,
            "learning_rate": args.lr,
            "weight_decay": args.weight_decay,
            "padding": args.padding,
            "seed": args.seed,
            "device": str(device),
            "best_model_path": str(best_model_path),
        },
        "history": history,
        "metrics": {
            "train": train_metrics,
            "valid": valid_metrics,
            "test": test_metrics,
        },
    }

    summary_path = output_dir / "metrics.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Saved metrics:", summary_path)
    print("Saved model:", best_model_path)
    print("TEST_METRICS", json.dumps(test_metrics, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
