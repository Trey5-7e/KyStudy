from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from PIL import Image

from tv07_ocr.worker import _recognize, _safe_recognize


class FakeOutput:
    def __init__(
        self,
        *,
        boxes: list[list[list[float]]],
        texts: list[str],
        scores: list[float],
    ) -> None:
        self.boxes = boxes
        self.txts = texts
        self.scores = scores


class FakeEngine:
    def __init__(self, output: FakeOutput) -> None:
        self._output = output

    def __call__(self, _: Path) -> Any:
        return self._output


class WorkerTests(unittest.TestCase):
    def test_recognize_returns_normalized_box_without_input_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            image_path = Path(temporary_directory) / "source.png"
            Image.new("RGB", (100, 200), "white").save(image_path)
            result = _recognize(
                FakeEngine(
                    FakeOutput(
                        boxes=[[[10, 20], [60, 20], [60, 80], [10, 80]]],
                        texts=["数据结构"],
                        scores=[0.99],
                    )
                ),
                image_path,
            )

        self.assertEqual(result["schemaVersion"], 1)
        self.assertEqual(result["lines"][0]["text"], "数据结构")
        self.assertEqual(
            result["lines"][0]["box"],
            {"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.3},
        )
        self.assertNotIn(str(image_path.resolve()), json.dumps(result, ensure_ascii=False))

    def test_safe_recognize_rejects_an_unsupported_suffix_without_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            input_path = Path(temporary_directory) / "source.txt"
            input_path.write_text("not an image", encoding="utf-8")
            result = _safe_recognize(
                FakeEngine(FakeOutput(boxes=[], texts=[], scores=[])),
                input_path,
            )

        self.assertEqual(result["error"]["code"], "OCR_INPUT_UNSUPPORTED")
        self.assertNotIn(str(input_path.resolve()), json.dumps(result))

    def test_safe_recognize_maps_an_invalid_box_to_a_stable_error(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            image_path = Path(temporary_directory) / "source.png"
            Image.new("RGB", (100, 200), "white").save(image_path)
            result = _safe_recognize(
                FakeEngine(
                    FakeOutput(
                        boxes=[[[10, 20], [60, 20], [60, 80]]],
                        texts=["invalid"],
                        scores=[0.5],
                    )
                ),
                image_path,
            )

        self.assertEqual(result["error"]["code"], "OCR_WORKER_FAILED")
        self.assertNotIn(str(image_path.resolve()), json.dumps(result))


if __name__ == "__main__":
    unittest.main()
