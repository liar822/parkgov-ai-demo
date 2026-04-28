#!/usr/bin/env python3
"""Generate a non-sensitive synthetic campus parking frame for ROI smoke tests.

This file is explicitly synthetic: it is not a real campus camera frame and is
only used to validate the image -> ROI -> model -> backend writeback pipeline.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def draw_parking_slot(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], occupied: bool, index: int) -> None:
    x1, y1, x2, y2 = box
    line_color = (230, 240, 235)
    fill_color = (62, 70, 78) if occupied else (188, 198, 190)
    draw.rounded_rectangle(box, radius=8, outline=line_color, width=3, fill=(42, 48, 52))
    inner = (x1 + 8, y1 + 12, x2 - 8, y2 - 12)
    if occupied:
      draw.rounded_rectangle(inner, radius=10, fill=fill_color)
      draw.rectangle((inner[0] + 8, inner[1] + 10, inner[2] - 8, inner[3] - 10), fill=(82, 94, 104))
      draw.ellipse((inner[0] + 6, inner[3] - 13, inner[0] + 18, inner[3] - 1), fill=(15, 18, 20))
      draw.ellipse((inner[2] - 18, inner[3] - 13, inner[2] - 6, inner[3] - 1), fill=(15, 18, 20))
    else:
      draw.line((x1 + 8, y1 + 8, x2 - 8, y2 - 8), fill=(136, 150, 142), width=2)
    draw.text((x1 + 6, y1 + 6), f"{index:02d}", fill=(235, 248, 242))


def generate(output_path: Path) -> None:
    width, height = 1280, 720
    image = Image.new("RGB", (width, height), (28, 36, 38))
    draw = ImageDraw.Draw(image)

    # Simple campus-like context: entry road, trees, and two parking rows.
    draw.rectangle((0, 0, width, 150), fill=(232, 237, 232))
    draw.rectangle((0, 150, width, height), fill=(54, 61, 62))
    draw.rectangle((0, 500, width, 720), fill=(72, 84, 78))
    draw.line((40, 500, 1240, 500), fill=(246, 246, 238), width=5)
    for x in range(60, 1240, 140):
        draw.ellipse((x, 42, x + 48, 90), fill=(57, 123, 93))
        draw.rectangle((x + 20, 86, x + 28, 150), fill=(107, 82, 56))

    try:
        font = ImageFont.truetype("Arial.ttf", 32)
    except OSError:
        font = ImageFont.load_default()
    draw.text((64, 48), "ParkGov AI synthetic campus parking sample", fill=(25, 34, 36), font=font)
    draw.text((64, 92), "Non-sensitive generated frame for ROI pipeline validation only", fill=(87, 96, 101))

    first_row = [
        (82, 214, 138, 332), (145, 214, 202, 332), (209, 215, 267, 331),
        (274, 216, 332, 332), (339, 216, 399, 332), (405, 218, 465, 332),
        (472, 219, 533, 333), (540, 220, 602, 334), (610, 221, 672, 333),
        (681, 222, 745, 334), (754, 223, 818, 334), (827, 224, 893, 334),
    ]
    second_row = [
        (98, 372, 156, 484), (164, 371, 222, 484), (230, 371, 289, 484),
        (297, 370, 356, 484), (365, 370, 425, 484), (434, 369, 494, 484),
        (504, 369, 565, 484), (575, 368, 637, 484), (647, 368, 709, 484),
        (720, 367, 783, 484), (794, 367, 858, 484), (869, 366, 934, 484),
    ]
    occupied_slots = {1, 2, 4, 5, 7, 9, 12, 13, 15, 16, 18, 19, 22, 24}
    for index, box in enumerate(first_row + second_row, start=1):
        draw_parking_slot(draw, box, index in occupied_slots, index)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a synthetic campus parking frame.")
    parser.add_argument(
        "--output",
        default="datasets/samples/campus/east-gate-synthetic-frame.png",
        help="Output image path relative to the workspace root.",
    )
    args = parser.parse_args()
    output_path = Path(args.output).expanduser()
    if not output_path.is_absolute():
        output_path = Path(__file__).resolve().parent.parents[3] / output_path
    generate(output_path)
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
