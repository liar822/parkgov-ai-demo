#!/usr/bin/env python3
"""Inspect the ACPDS parking occupancy dataset archive.

This script intentionally uses only Python's standard library. It is a
pre-training guardrail: before we build loaders or train a model, it confirms
that the archive, labels, split sizes, and optional baseline weights are present.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
import zipfile
from pathlib import Path
from typing import Any, Dict, Iterable, List


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def count_truthy(values: Iterable[Any]) -> int:
    return sum(1 for value in values if bool(value))


def split_summary(split_name: str, payload: Dict[str, Any], sample_limit: int) -> Dict[str, Any]:
    file_names: List[str] = payload.get("file_names", [])
    rois_list: List[List[Any]] = payload.get("rois_list", [])
    occupancy_list: List[List[Any]] = payload.get("occupancy_list", [])

    slot_counts = [len(rois) for rois in rois_list]
    occupied_counts = [count_truthy(row) for row in occupancy_list]
    total_slots = sum(slot_counts)
    occupied = sum(occupied_counts)
    vacant = total_slots - occupied

    samples = []
    for index, file_name in enumerate(file_names[:sample_limit]):
        slots = slot_counts[index] if index < len(slot_counts) else 0
        sample_occupied = occupied_counts[index] if index < len(occupied_counts) else 0
        samples.append(
            {
                "file_name": file_name,
                "slot_count": slots,
                "occupied": sample_occupied,
                "vacant": slots - sample_occupied,
            }
        )

    return {
        "split": split_name,
        "images": len(file_names),
        "slot_instances": total_slots,
        "occupied": occupied,
        "vacant": vacant,
        "slots_per_image": {
            "min": min(slot_counts) if slot_counts else 0,
            "max": max(slot_counts) if slot_counts else 0,
            "mean": round(statistics.mean(slot_counts), 2) if slot_counts else 0,
        },
        "samples": samples,
    }


def inspect_dataset(zip_path: Path, weights_path: Path | None, sample_limit: int) -> Dict[str, Any]:
    if not zip_path.exists():
        raise FileNotFoundError(f"ACPDS archive not found: {zip_path}")

    with zipfile.ZipFile(zip_path) as archive:
        names = archive.namelist()
        if "annotations.json" not in names:
            raise ValueError("annotations.json not found in ACPDS archive")

        image_files = [
            name
            for name in names
            if name.lower().endswith((".jpg", ".jpeg", ".png"))
        ]

        with archive.open("annotations.json") as handle:
            annotations = json.load(handle)

    if not isinstance(annotations, dict):
        raise ValueError("Expected annotations.json to contain an object keyed by split name")

    splits = [
        split_summary(split_name, payload, sample_limit)
        for split_name, payload in annotations.items()
        if isinstance(payload, dict)
    ]

    total_slot_instances = sum(split["slot_instances"] for split in splits)
    total_occupied = sum(split["occupied"] for split in splits)

    weights = None
    if weights_path is not None:
        weights = {
            "path": str(weights_path),
            "exists": weights_path.exists(),
            "size_bytes": weights_path.stat().st_size if weights_path.exists() else None,
            "sha256": sha256_file(weights_path) if weights_path.exists() else None,
        }

    return {
        "dataset": "ACPDS",
        "archive": {
            "path": str(zip_path),
            "size_bytes": zip_path.stat().st_size,
            "sha256": sha256_file(zip_path),
            "zip_entries": len(names),
            "image_files": len(image_files),
        },
        "annotations": {
            "splits": splits,
            "totals": {
                "images": sum(split["images"] for split in splits),
                "slot_instances": total_slot_instances,
                "occupied": total_occupied,
                "vacant": total_slot_instances - total_occupied,
            },
        },
        "baseline_weights": weights,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect ACPDS dataset archive")
    parser.add_argument(
        "--zip",
        default="../../../datasets/raw/acpds/rois_gopro.zip",
        help="Path to rois_gopro.zip",
    )
    parser.add_argument(
        "--weights",
        default="../../../datasets/raw/acpds/RCNN_128_square_gopro.pt",
        help="Optional path to ACPDS baseline weights",
    )
    parser.add_argument(
        "--sample-limit",
        type=int,
        default=3,
        help="Number of sample image rows to include per split",
    )
    parser.add_argument(
        "--output-json",
        help="Optional path for writing the inspection summary JSON",
    )
    args = parser.parse_args()

    zip_path = Path(args.zip).expanduser().resolve()
    weights_path = Path(args.weights).expanduser().resolve() if args.weights else None

    try:
        summary = inspect_dataset(zip_path, weights_path, args.sample_limit)
    except Exception as exc:
        print(f"ACPDS inspection failed: {exc}", file=sys.stderr)
        return 1

    output = json.dumps(summary, ensure_ascii=False, indent=2)
    print(output)

    if args.output_json:
        output_path = Path(args.output_json).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(output + "\n", encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
