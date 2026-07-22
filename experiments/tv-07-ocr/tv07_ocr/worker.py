from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path
from typing import Any

from PIL import Image
from rapidocr import RapidOCR
from rapidocr.utils.output import RapidOCROutput

SCHEMA_VERSION = 1
ENGINE_NAME = "rapidocr-3.9.2-ppocrv6-small-onnx-cpu"
SUPPORTED_SUFFIXES = frozenset({".bmp", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"})
MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_PIXELS = 80_000_000


def _write_json(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _error(code: str) -> dict[str, Any]:
    return {"schemaVersion": SCHEMA_VERSION, "error": {"code": code}}


def _load_image_metadata(image_path: Path) -> tuple[Path, int, int]:
    resolved = image_path.resolve(strict=True)
    if not resolved.is_file() or resolved.suffix.casefold() not in SUPPORTED_SUFFIXES:
        raise ValueError("OCR_INPUT_UNSUPPORTED")
    if resolved.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("OCR_INPUT_TOO_LARGE")
    with Image.open(resolved) as image:
        width, height = image.size
        image.verify()
    if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
        raise ValueError("OCR_INPUT_TOO_LARGE")
    return resolved, width, height


def _normalize_box(box: Any, width: int, height: int) -> dict[str, float]:
    points = [(float(point[0]), float(point[1])) for point in box]
    if len(points) != 4 or not all(
        math.isfinite(coordinate) for point in points for coordinate in point
    ):
        raise RuntimeError("OCR_RESULT_INVALID")
    minimum_x = min(point[0] for point in points)
    maximum_x = max(point[0] for point in points)
    minimum_y = min(point[1] for point in points)
    maximum_y = max(point[1] for point in points)
    x = max(0.0, min(1.0, minimum_x / width))
    y = max(0.0, min(1.0, minimum_y / height))
    right = max(0.0, min(1.0, maximum_x / width))
    bottom = max(0.0, min(1.0, maximum_y / height))
    if right <= x or bottom <= y:
        raise RuntimeError("OCR_RESULT_INVALID")
    return {
        "x": round(x, 6),
        "y": round(y, 6),
        "width": round(right - x, 6),
        "height": round(bottom - y, 6),
    }


def _create_engine() -> RapidOCR:
    return RapidOCR(
        params={
            "Global.log_level": "critical",
            "Global.use_cls": False,
        }
    )


def _recognize(engine: RapidOCR, image_path: Path) -> dict[str, Any]:
    resolved, width, height = _load_image_metadata(image_path)
    started = time.perf_counter()
    output: RapidOCROutput = engine(resolved)
    elapsed_ms = (time.perf_counter() - started) * 1000
    if output.boxes is None or output.txts is None or output.scores is None:
        lines: list[dict[str, Any]] = []
    else:
        if not (len(output.boxes) == len(output.txts) == len(output.scores)):
            raise RuntimeError("OCR_RESULT_INVALID")
        lines = [
            {
                "text": text,
                "confidence": round(float(score), 6),
                "box": _normalize_box(box, width, height),
            }
            for box, text, score in zip(
                output.boxes,
                output.txts,
                output.scores,
                strict=True,
            )
        ]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "engine": ENGINE_NAME,
        "width": width,
        "height": height,
        "elapsedMs": round(elapsed_ms, 2),
        "lines": lines,
    }


def _safe_recognize(engine: RapidOCR, image_path: Path) -> dict[str, Any]:
    try:
        return _recognize(engine, image_path)
    except ValueError as error:
        code = str(error)
        if code.startswith("OCR_"):
            return _error(code)
        sys.stderr.write(f"OCR worker input failure: {type(error).__name__}\n")
        return _error("OCR_INPUT_INVALID")
    except (OSError, RuntimeError) as error:
        sys.stderr.write(f"OCR worker failure: {type(error).__name__}\n")
        return _error("OCR_WORKER_FAILED")
    except Exception as error:
        sys.stderr.write(f"OCR engine failure: {type(error).__name__}\n")
        return _error("OCR_ENGINE_FAILED")


def _serve() -> int:
    started = time.perf_counter()
    engine = _create_engine()
    _write_json(
        {
            "schemaVersion": SCHEMA_VERSION,
            "type": "ready",
            "engine": ENGINE_NAME,
            "initializationMs": round((time.perf_counter() - started) * 1000, 2),
        }
    )
    for raw_line in sys.stdin:
        try:
            request = json.loads(raw_line)
        except json.JSONDecodeError:
            _write_json(_error("OCR_REQUEST_INVALID"))
            continue
        if not isinstance(request, dict):
            _write_json(_error("OCR_REQUEST_INVALID"))
            continue
        request_id = request.get("id")
        command = request.get("command")
        if command == "shutdown":
            _write_json({"schemaVersion": SCHEMA_VERSION, "id": request_id, "type": "stopped"})
            return 0
        image = request.get("image")
        if not isinstance(request_id, str) or not isinstance(image, str):
            _write_json(_error("OCR_REQUEST_INVALID"))
            continue
        response = _safe_recognize(engine, Path(image))
        response["id"] = request_id
        _write_json(response)
    return 0


def _once(image_path: Path) -> int:
    _write_json(_safe_recognize(_create_engine(), image_path))
    return 0


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="strict")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    once_parser = subparsers.add_parser("once")
    once_parser.add_argument("image", type=Path)
    subparsers.add_parser("serve")
    arguments = parser.parse_args()
    if arguments.command == "once":
        return _once(arguments.image)
    return _serve()


if __name__ == "__main__":
    raise SystemExit(main())
