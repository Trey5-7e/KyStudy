"""Shared image preparation and backend adapter primitives for OCR.

The desktop application only consumes the stable JSON returned by ``worker``.
Keeping image preparation and backend invocation behind these small protocols
lets us compare RapidOCR, PaddleOCR, and Docling without changing the Tauri
boundary or the PDF indexer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from PIL import Image, ImageEnhance, ImageFilter, ImageOps, ImageStat

MIN_DOCUMENT_LONG_EDGE = 1_600
MAX_DOCUMENT_LONG_EDGE = 3_200
INVERT_MEAN_THRESHOLD = 82.0
MAX_SAME_LINE_TOP_DELTA = 0.016


class OcrBackend(Protocol):
    """Minimal adapter contract shared by OCR engine implementations."""

    name: str

    def recognize(self, image: Image.Image) -> Any:
        """Recognize a prepared RGB image and return a backend-native result."""


@dataclass(frozen=True)
class PreprocessReport:
    """Stable diagnostics for local benchmark output, without source paths."""

    source_width: int
    source_height: int
    prepared_width: int
    prepared_height: int
    upscaled: bool
    inverted: bool
    grayscale: bool


def prepare_document_image(image: Image.Image) -> tuple[Image.Image, PreprocessReport]:
    """Prepare a page/region while preserving the original aspect ratio.

    PDF pages are rendered with a white background, but user-captured regions
    can contain EXIF rotation, uneven illumination, or an inverted scan. The
    transform deliberately avoids cropping so normalized OCR boxes remain
    compatible with the existing Tauri contract.
    """

    oriented = ImageOps.exif_transpose(image).convert("RGB")
    source_width, source_height = oriented.size
    long_edge = max(source_width, source_height)
    scale = 1.0
    if 0 < long_edge < MIN_DOCUMENT_LONG_EDGE:
        scale = MIN_DOCUMENT_LONG_EDGE / long_edge
    elif long_edge > MAX_DOCUMENT_LONG_EDGE:
        scale = MAX_DOCUMENT_LONG_EDGE / long_edge
    if scale != 1.0:
        width = max(1, round(source_width * scale))
        height = max(1, round(source_height * scale))
        oriented = oriented.resize((width, height), Image.Resampling.LANCZOS)

    grayscale = ImageOps.grayscale(oriented)
    mean = ImageStat.Stat(grayscale).mean[0]
    inverted = mean < INVERT_MEAN_THRESHOLD
    if inverted:
        grayscale = ImageOps.invert(grayscale)
    grayscale = ImageOps.autocontrast(grayscale, cutoff=0.5)
    grayscale = ImageEnhance.Contrast(grayscale).enhance(1.12)
    grayscale = grayscale.filter(ImageFilter.UnsharpMask(radius=1.0, percent=120, threshold=3))

    prepared = grayscale.convert("RGB")
    return prepared, PreprocessReport(
        source_width=source_width,
        source_height=source_height,
        prepared_width=prepared.width,
        prepared_height=prepared.height,
        upscaled=scale > 1.0,
        inverted=inverted,
        grayscale=True,
    )


def sort_backend_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group formula/text fragments into stable reading-order lines.

    RapidOCR returns one box for many formula fragments (superscripts,
    operators, and symbols). Grouping only vertically overlapping boxes keeps
    table-of-contents rows separate while making a question's OCR text useful
    to search and the PDF indexer.
    """

    ordered = sorted(
        lines,
        key=lambda line: (
            float(line["box"]["y"]),
            float(line["box"]["x"]),
        ),
    )
    groups: list[list[dict[str, Any]]] = []
    for line in ordered:
        best_group: list[dict[str, Any]] | None = None
        best_overlap = 0.0
        for group in groups:
            overlap = _vertical_overlap(line, group)
            if overlap > best_overlap:
                best_overlap = overlap
                best_group = group
        if best_group is None or best_overlap < 0.15:
            groups.append([line])
        else:
            best_group.append(line)

    merged = [_merge_line_group(group) for group in groups]
    return sorted(merged, key=lambda line: (line["box"]["y"], line["box"]["x"]))


def _vertical_overlap(line: dict[str, Any], group: list[dict[str, Any]]) -> float:
    line_box = line["box"]
    line_top = float(line_box["y"])
    if min(
        abs(line_top - float(item["box"]["y"])) for item in group
    ) > MAX_SAME_LINE_TOP_DELTA:
        return 0.0
    group_top = min(float(item["box"]["y"]) for item in group)
    group_bottom = max(
        float(item["box"]["y"]) + float(item["box"]["height"]) for item in group
    )
    line_bottom = line_top + float(line_box["height"])
    overlap = max(0.0, min(line_bottom, group_bottom) - max(line_top, group_top))
    smallest_height = min(
        float(line_box["height"]),
        min(float(item["box"]["height"]) for item in group),
    )
    return overlap / smallest_height if smallest_height > 0 else 0.0


def _merge_line_group(group: list[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(group, key=lambda line: float(line["box"]["x"]))
    text = ""
    for line in ordered:
        value = str(line["text"]).strip()
        if value == "":
            continue
        if text != "" and _needs_space(text[-1], value[0]):
            text += " "
        text += value
    left = min(float(line["box"]["x"]) for line in ordered)
    top = min(float(line["box"]["y"]) for line in ordered)
    right = max(
        float(line["box"]["x"]) + float(line["box"]["width"]) for line in ordered
    )
    bottom = max(
        float(line["box"]["y"]) + float(line["box"]["height"]) for line in ordered
    )
    confidence = sum(float(line["confidence"]) for line in ordered) / len(ordered)
    return {
        "text": text,
        "confidence": round(confidence, 6),
        "box": {
            "x": round(left, 6),
            "y": round(top, 6),
            "width": round(right - left, 6),
            "height": round(bottom - top, 6),
        },
    }


def _needs_space(previous: str, current: str) -> bool:
    if previous.isspace() or current.isspace():
        return False
    if "\u3400" <= previous <= "\u9fff" or "\u3400" <= current <= "\u9fff":
        return False
    return current not in ",.;:!?)]}，。！？）》】" and previous not in "([{（【"
