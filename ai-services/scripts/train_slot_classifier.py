#!/usr/bin/env python3
"""Train/evaluate a slot occupied-vacant classifier on supported datasets.

Supported datasets:
- acpds: ROI annotations from ACPDS rois_gopro.zip
- cnrpark_ext: CNRPark/CNR-EXT patch zip files with LABELS split files or
  paths containing free/busy class names.
"""

from __future__ import annotations

import argparse
import csv
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
from torch.utils.data import DataLoader, Dataset, TensorDataset, WeightedRandomSampler

from train_acpds_slot_classifier import (  # noqa: E402
    SlotOccupancyCNN,
    build_split_tensors,
    choose_device,
    format_metric,
    metrics_from_predictions,
    normalize_batch,
    rounded_metrics,
    set_seed,
)


@dataclass
class SplitTensors:
    name: str
    images: torch.Tensor | None
    labels: torch.Tensor
    image_count: int
    slot_instances: int
    dataset: Dataset | None = None


class CnrPatchDataset(Dataset):
    def __init__(self, zip_path: Path, entries: List[Tuple[str, int]], image_size: int) -> None:
        self.zip_path = zip_path
        self.entries = entries
        self.image_size = image_size
        self._archive: zipfile.ZipFile | None = None

    def __len__(self) -> int:
        return len(self.entries)

    def archive(self) -> zipfile.ZipFile:
        if self._archive is None:
            self._archive = zipfile.ZipFile(self.zip_path)
        return self._archive

    def __getitem__(self, index: int) -> Tuple[torch.Tensor, torch.Tensor]:
        image_path, label = self.entries[index]
        patch = load_patch(self.archive(), image_path, self.image_size)
        return patch, torch.tensor(label, dtype=torch.long)


def resolve_path(value: str) -> Path:
    candidates = []
    raw = Path(value).expanduser()
    if raw.is_absolute():
        candidates.append(raw)
    else:
        cwd = Path.cwd()
        ai_root = Path(__file__).resolve().parents[1]
        project_root = Path(__file__).resolve().parents[3]
        workspace_root = Path(__file__).resolve().parents[4]
        candidates.extend([
            (cwd / raw).resolve(),
            (ai_root / raw).resolve(),
            (project_root / raw).resolve(),
            (workspace_root / raw).resolve(),
        ])

    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def load_acpds_splits(args: argparse.Namespace) -> Tuple[SplitTensors, SplitTensors, SplitTensors, Dict[str, Any]]:
    zip_path = resolve_path(args.archive)
    with zipfile.ZipFile(zip_path) as archive:
        with archive.open("annotations.json") as handle:
            annotations = json.load(handle)
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

    dataset_info = {
        "name": "ACPDS",
        "archive": str(zip_path),
        "license": "MIT per ACPDS paper/repository",
    }
    return train_split, valid_split, test_split, dataset_info


def cnr_entries_from_metadata(zip_path: Path, archive: zipfile.ZipFile) -> Dict[str, List[Tuple[str, int]]] | None:
    metadata_path = zip_path.with_name("CNRPark+EXT.csv")
    if not metadata_path.exists():
        return None

    archive_names = {
        name for name in archive.namelist()
        if name.lower().endswith((".jpg", ".jpeg", ".png"))
    }
    entries: List[Tuple[str, int]] = []
    with metadata_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            image_url = (row.get("image_url") or "").strip()
            occupancy = (row.get("occupancy") or "").strip()
            if not image_url or occupancy not in {"0", "1"}:
                continue
            normalized = image_url
            if normalized.startswith("CNR-EXT/"):
                normalized = normalized[len("CNR-EXT/"):]
            if normalized in archive_names:
                entries.append((normalized, int(occupancy)))

    if not entries:
        return None

    random.Random(42).shuffle(entries)
    train_end = int(len(entries) * 0.72)
    valid_end = int(len(entries) * 0.84)
    return {
        "train": entries[:train_end],
        "valid": entries[train_end:valid_end],
        "test": entries[valid_end:],
    }


def cnr_label_entries(zip_path: Path, archive: zipfile.ZipFile) -> Dict[str, List[Tuple[str, int]]]:
    metadata_entries = cnr_entries_from_metadata(zip_path, archive)
    if metadata_entries:
        return metadata_entries

    label_files = [name for name in archive.namelist() if "/LABELS/" in f"/{name}" and name.lower().endswith(".txt")]
    entries: Dict[str, List[Tuple[str, int]]] = {"train": [], "valid": [], "test": []}
    if label_files:
        for label_file in label_files:
            lower_name = label_file.lower()
            if "train" in lower_name:
                split = "train"
            elif "val" in lower_name or "valid" in lower_name:
                split = "valid"
            elif "test" in lower_name:
                split = "test"
            else:
                continue

            with archive.open(label_file) as handle:
                for raw_line in handle.read().decode("utf-8", errors="ignore").splitlines():
                    line = raw_line.strip()
                    if not line or line.startswith("#"):
                        continue
                    parts = line.split()
                    if len(parts) < 2:
                        continue
                    image_path = parts[0].lstrip("./")
                    label = int(parts[-1])
                    entries[split].append((image_path, 1 if label == 1 else 0))
        if entries["train"] and entries["test"]:
            if not entries["valid"]:
                valid_size = max(1, int(len(entries["train"]) * 0.12))
                entries["valid"] = entries["train"][:valid_size]
                entries["train"] = entries["train"][valid_size:]
            return entries

    image_names = [
        name for name in archive.namelist()
        if name.lower().endswith((".jpg", ".jpeg", ".png"))
        and not name.endswith("/")
    ]
    inferred = []
    for name in image_names:
        lower_name = name.lower()
        if "/busy/" in lower_name or "busy" in lower_name:
            inferred.append((name, 1))
        elif "/free/" in lower_name or "free" in lower_name:
            inferred.append((name, 0))

    if not inferred:
        raise ValueError("Unable to locate CNRPark labels. Expected LABELS/*.txt or paths containing free/busy.")

    random.Random(42).shuffle(inferred)
    train_end = int(len(inferred) * 0.72)
    valid_end = int(len(inferred) * 0.84)
    return {
        "train": inferred[:train_end],
        "valid": inferred[train_end:valid_end],
        "test": inferred[valid_end:],
    }


def load_patch(archive: zipfile.ZipFile, image_path: str, image_size: int) -> torch.Tensor:
    try_paths = [image_path]
    if not image_path.startswith("PATCHES/"):
        try_paths.append(f"PATCHES/{image_path}")

    last_error: Exception | None = None
    for candidate in try_paths:
        try:
            with archive.open(candidate) as image_handle:
                image = Image.open(BytesIO(image_handle.read()))
                image.load()
                image = ImageOps.exif_transpose(image).convert("RGB")
                patch = image.resize((image_size, image_size), Image.Resampling.BILINEAR)
                array = np.asarray(patch, dtype=np.uint8).copy()
                return torch.from_numpy(array).permute(2, 0, 1).contiguous()
        except Exception as error:  # noqa: BLE001
            last_error = error

    raise FileNotFoundError(f"Unable to read patch {image_path}: {last_error}")


def build_cnr_split(archive: zipfile.ZipFile, name: str, entries: List[Tuple[str, int]], image_size: int, max_samples: int | None) -> SplitTensors:
    selected = entries[:max_samples] if max_samples else entries
    if not selected:
        raise ValueError(f"No CNRPark entries found for split {name}.")

    zip_path = Path(archive.filename).resolve()
    labels = [label for _, label in selected]
    return SplitTensors(
        name=name,
        images=None,
        labels=torch.tensor(labels, dtype=torch.long),
        image_count=len(selected),
        slot_instances=len(selected),
        dataset=CnrPatchDataset(zip_path, selected, image_size),
    )


def load_cnr_splits(args: argparse.Namespace) -> Tuple[SplitTensors, SplitTensors, SplitTensors, Dict[str, Any]]:
    zip_path = resolve_path(args.archive)
    with zipfile.ZipFile(zip_path) as archive:
        entries = cnr_label_entries(zip_path, archive)
        train_split = build_cnr_split(archive, "train", entries["train"], args.image_size, args.max_train_samples)
        valid_split = build_cnr_split(archive, "valid", entries["valid"], args.image_size, args.max_valid_samples)
        test_split = build_cnr_split(archive, "test", entries["test"], args.image_size, args.max_test_samples)

    dataset_info = {
        "name": "CNRPark+EXT",
        "archive": str(zip_path),
        "metadata": str(zip_path.with_name("CNRPark+EXT.csv")),
        "license": "ODbL v1.0 per official CNRPark+EXT page",
    }
    return train_split, valid_split, test_split, dataset_info


def load_splits(args: argparse.Namespace) -> Tuple[SplitTensors, SplitTensors, SplitTensors, Dict[str, Any]]:
    if args.dataset == "acpds":
        return load_acpds_splits(args)
    if args.dataset == "cnrpark_ext":
        return load_cnr_splits(args)
    raise ValueError(f"Unsupported dataset: {args.dataset}")


def split_dataset(split: SplitTensors) -> Dataset:
    if split.dataset is not None:
        return split.dataset
    if split.images is None:
        raise ValueError(f"Split {split.name} has neither tensor images nor a dataset.")
    return TensorDataset(split.images, split.labels)


@torch.no_grad()
def evaluate_split(model: nn.Module, split: SplitTensors, batch_size: int, device: torch.device) -> Dict[str, Any]:
    model.eval()
    loader = DataLoader(split_dataset(split), batch_size=batch_size, shuffle=False)
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


def train_epoch(
    model: nn.Module,
    train_split: SplitTensors,
    batch_size: int,
    device: torch.device,
    optimizer: torch.optim.Optimizer,
    class_weights: torch.Tensor,
    use_balanced_sampler: bool,
) -> float:
    model.train()
    dataset = split_dataset(train_split)
    sampler = None
    shuffle = True
    if use_balanced_sampler:
        label_counts = torch.bincount(train_split.labels, minlength=2).float()
        sample_weights = torch.tensor(
            [1.0 / float(label_counts[int(label)].item()) for label in train_split.labels],
            dtype=torch.double,
        )
        sampler = WeightedRandomSampler(sample_weights, num_samples=len(sample_weights), replacement=True)
        shuffle = False

    loader = DataLoader(dataset, batch_size=batch_size, shuffle=shuffle, sampler=sampler)
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


def checkpoint_payload(model: nn.Module, args: argparse.Namespace, dataset_info: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "model_state_dict": model.state_dict(),
        "image_size": args.image_size,
        "padding": args.padding,
        "dataset": dataset_info,
        "label_map": {"vacant": 0, "occupied": 1},
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Train/evaluate parking slot occupied-vacant classifier")
    parser.add_argument("--dataset", choices=["acpds", "cnrpark_ext"], required=True)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--output-dir", default="training_runs/slot_classifier")
    parser.add_argument("--checkpoint")
    parser.add_argument("--mode", choices=["train", "evaluate"], default="train")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--image-size", type=int, default=96)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--padding", type=float, default=0.12)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--max-samples", type=int)
    parser.add_argument("--max-train-samples", type=int)
    parser.add_argument("--max-valid-samples", type=int)
    parser.add_argument("--max-test-samples", type=int)
    parser.add_argument("--balanced-sampler", action=argparse.BooleanOptionalAction, default=True)
    args = parser.parse_args()

    if args.max_samples:
        args.max_train_samples = args.max_train_samples or args.max_samples
        args.max_valid_samples = args.max_valid_samples or max(1, args.max_samples // 5)
        args.max_test_samples = args.max_test_samples or max(1, args.max_samples // 5)

    set_seed(args.seed)
    device = choose_device(args.device)
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    started_at = datetime.now().isoformat(timespec="seconds")
    start_time = time.time()

    print(f"Loading {args.dataset} from {resolve_path(args.archive)}")
    print(f"Using device: {device}")
    train_split, valid_split, test_split, dataset_info = load_splits(args)
    print(
        "Loaded splits: "
        f"train={train_split.slot_instances}, "
        f"valid={valid_split.slot_instances}, "
        f"test={test_split.slot_instances}"
    )

    model = SlotOccupancyCNN().to(device)
    history: List[Dict[str, Any]] = []

    if args.checkpoint:
        checkpoint_path = resolve_path(args.checkpoint)
        checkpoint = torch.load(checkpoint_path, map_location=device)
        model.load_state_dict(checkpoint.get("model_state_dict", checkpoint))
        best_model_path = checkpoint_path
    else:
        label_counts = torch.bincount(train_split.labels, minlength=2).float()
        class_weights = (label_counts.sum() / (2 * label_counts)).to(device)
        optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
        best_valid_accuracy = -1.0
        best_model_path = output_dir / f"{args.dataset}_slot_cnn_best.pt"

        if args.mode == "evaluate":
            raise ValueError("--checkpoint is required when --mode evaluate.")

        for epoch in range(1, args.epochs + 1):
            train_loss = train_epoch(
                model,
                train_split,
                args.batch_size,
                device,
                optimizer,
                class_weights,
                args.balanced_sampler,
            )
            valid_metrics = evaluate_split(model, valid_split, args.batch_size, device)
            train_metrics = evaluate_split(model, train_split, args.batch_size, device)
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
                torch.save(checkpoint_payload(model, args, dataset_info), best_model_path)

        checkpoint = torch.load(best_model_path, map_location=device)
        model.load_state_dict(checkpoint["model_state_dict"])

    train_metrics = rounded_metrics(evaluate_split(model, train_split, args.batch_size, device))
    valid_metrics = rounded_metrics(evaluate_split(model, valid_split, args.batch_size, device))
    test_metrics = rounded_metrics(evaluate_split(model, test_split, args.batch_size, device))
    summary = {
        "run_name": f"{args.dataset}_{args.mode}",
        "started_at": started_at,
        "finished_at": datetime.now().isoformat(timespec="seconds"),
        "duration_seconds": round(time.time() - start_time, 2),
        "dataset": {
            **dataset_info,
            "train_slot_instances": train_split.slot_instances,
            "valid_slot_instances": valid_split.slot_instances,
            "test_slot_instances": test_split.slot_instances,
        },
        "training": {
            "model": "SlotOccupancyCNN",
            "mode": args.mode,
            "epochs": 0 if args.checkpoint else args.epochs,
            "batch_size": args.batch_size,
            "image_size": args.image_size,
            "learning_rate": args.lr,
            "weight_decay": args.weight_decay,
            "seed": args.seed,
            "device": str(device),
            "best_model_path": str(best_model_path),
            "balanced_sampler": args.balanced_sampler,
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
