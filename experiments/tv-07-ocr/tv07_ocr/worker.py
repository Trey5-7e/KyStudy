from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image
from rapidocr import RapidOCR
from rapidocr.utils.output import RapidOCROutput

from tv07_ocr.pipeline import OcrBackend, prepare_document_image, sort_backend_lines

try:
    from paddleocr import FormulaRecognitionPipeline
except ImportError:  # pragma: no cover - the stable text-only env omits PaddleOCR.
    FormulaRecognitionPipeline = None  # type: ignore[assignment,misc]

SCHEMA_VERSION = 1
ENGINE_NAME = "rapidocr-3.9.2-ppocrv6-small-onnx-cpu"
SUPPORTED_SUFFIXES = frozenset({".bmp", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"})
MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_PIXELS = 80_000_000
FORMULA_MODEL_NAME = "PP-FormulaNet_plus-M"
FORMULA_MIN_ASPECT_RATIO = 3.0
FORMULA_MAX_REGION_HEIGHT = 900


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


class RapidOcrBackend:
    """RapidOCR implementation of the shared local OCR backend contract."""

    name = ENGINE_NAME

    def __init__(self) -> None:
        self._engine = RapidOCR(
            params={
                "Global.log_level": "critical",
                # Orientation classification materially helps phone captures
                # and rotated workbook pages; PDF pages pay only a small cost.
                "Global.use_cls": True,
            }
        )
        self._formula_engine: Any | None = None
        self._formula_disabled = False

    def recognize(self, image: Image.Image) -> RapidOCROutput:
        return self._engine(image)

    def recognize_formula(self, image: Image.Image) -> str | None:
        """Recognize a narrow mixed text/formula crop when Paddle is bundled.

        Whole-page OCR stays on the lightweight RapidOCR path. FormulaNet is
        only invoked for the narrow regions produced by question OCR, where a
        full-page layout pass would add a large amount of CPU and memory cost.
        A missing optional model is a normal downgrade, not a worker failure.
        """

        if (
            FormulaRecognitionPipeline is None
            or self._formula_disabled
            or not _looks_like_formula_region(image)
        ):
            return None
        model_dir = _formula_model_dir()
        if model_dir is None:
            return None
        try:
            if self._formula_engine is None:
                self._formula_engine = FormulaRecognitionPipeline(
                    formula_recognition_model_name=FORMULA_MODEL_NAME,
                    formula_recognition_model_dir=str(model_dir),
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_layout_detection=False,
                    device="cpu",
                    enable_mkldnn=False,
                )
            results = self._formula_engine.predict(np.asarray(image))
            result = next(iter(results), None)
            if result is None:
                return None
            formulas = [
                str(item.get("rec_formula", "")).strip()
                for item in result.get("formula_res_list", [])
                if isinstance(item, dict)
            ]
            formula = " ".join(value for value in formulas if value != "")
            return formula if len(formula) >= 8 else None
        except Exception as error:  # pragma: no cover - depends on optional Paddle runtime.
            self._formula_disabled = True
            detail = str(error).strip().replace("\n", " ")
            suffix = f": {detail}" if detail else ""
            sys.stderr.write(
                f"Formula OCR fallback disabled: {type(error).__name__}{suffix}\n"
            )
            return None


def _create_engine() -> OcrBackend:
    return RapidOcrBackend()


def _recognize(engine: OcrBackend, image_path: Path) -> dict[str, Any]:
    resolved, width, height = _load_image_metadata(image_path)
    with Image.open(resolved) as source_image:
        prepared_image, preprocess = prepare_document_image(source_image)
    started = time.perf_counter()
    output: RapidOCROutput = engine.recognize(prepared_image)
    elapsed_ms = (time.perf_counter() - started) * 1000
    rapid_lines = _rapid_lines(output, preprocess.prepared_width, preprocess.prepared_height)
    formula_text = _formula_text(engine, prepared_image, rapid_lines)
    lines = (
        [
            {
                "text": _compose_formula_text(formula_text, rapid_lines, prepared_image),
                "confidence": 0.9,
                "box": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
            }
        ]
        if formula_text is not None
        else rapid_lines
    )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "engine": ENGINE_NAME,
        "width": width,
        "height": height,
        "elapsedMs": round(elapsed_ms, 2),
        "preprocess": {
            "upscaled": preprocess.upscaled,
            "inverted": preprocess.inverted,
            "grayscale": preprocess.grayscale,
            "formulaEnhanced": formula_text is not None,
        },
        "lines": lines,
    }


def _rapid_lines(output: RapidOCROutput, width: int, height: int) -> list[dict[str, Any]]:
    if output.boxes is None or output.txts is None or output.scores is None:
        return []
    if not (len(output.boxes) == len(output.txts) == len(output.scores)):
        raise RuntimeError("OCR_RESULT_INVALID")
    return sort_backend_lines([
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
    ])


def _formula_text(
    engine: OcrBackend,
    image: Image.Image,
    rapid_lines: list[dict[str, Any]],
) -> str | None:
    recognizer = getattr(engine, "recognize_formula", None)
    if not callable(recognizer):
        return None
    return recognizer(image)


def _formula_model_dir() -> Path | None:
    configured = os.environ.get("KYSTUDY_OCR_FORMULA_MODEL_DIR", "").strip()
    candidates = [Path(configured)] if configured else []
    runtime_root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    candidates.append(runtime_root / "formula_models" / FORMULA_MODEL_NAME)
    candidates.append(
        Path.home() / ".paddlex" / "official_models" / FORMULA_MODEL_NAME
    )
    return next((path for path in candidates if path.is_dir()), None)


def _looks_like_formula_region(image: Image.Image) -> bool:
    width, height = image.size
    return (
        height > 0
        and width / height >= FORMULA_MIN_ASPECT_RATIO
        and height <= FORMULA_MAX_REGION_HEIGHT
    )


def _compose_formula_text(
    formula: str,
    rapid_lines: list[dict[str, Any]],
    image: Image.Image,
) -> str:
    source_text = " ".join(str(line["text"]) for line in rapid_lines)
    number = re.search(
        r"(?<![\w])(?P<number>\d{1,3})\s*(?=[\u3400-\u9fff])",
        source_text,
    )
    chinese = list(dict.fromkeys(re.findall(r"[\u3400-\u9fff]+", source_text)))
    has_clause_separator = r"\quad" in formula
    if number is not None and chinese[:1] == ["第"]:
        chinese[0] = "设"
    prefix = " ".join(
        value
        for value in ([number.group("number")] if number is not None else [])
        + chinese[:1 if has_clause_separator else 2]
    )
    rendered = formula.replace(r"\\quad", "，则")
    rendered = rendered.replace(r"\quad", "，则")
    rendered = rendered.replace(",，则", "，则").replace(",，", "，")
    if _has_answer_blank(image) and "=" in rendered:
        left, _ = rendered.rsplit("=", 1)
        rendered = f"{left}=_____"
    return f"{prefix} {rendered}".strip()


def _has_answer_blank(image: Image.Image) -> bool:
    grayscale = image.convert("L")
    width, height = grayscale.size
    pixels = np.asarray(grayscale)
    # Formula screenshots can include large whitespace below the question, so
    # the answer rule may appear above the vertical midpoint. Scan the whole
    # crop and require a long dark run; normal fraction bars are substantially
    # shorter than the blank rule and remain below this threshold.
    start_y = 0
    threshold = 145
    minimum_run = max(64, round(width * 0.075))
    for y in range(start_y, height):
        run = 0
        for value in pixels[y]:
            if value < threshold:
                run += 1
                if run >= minimum_run:
                    return True
            else:
                run = 0
    return False


def _safe_recognize(engine: OcrBackend, image_path: Path) -> dict[str, Any]:
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
