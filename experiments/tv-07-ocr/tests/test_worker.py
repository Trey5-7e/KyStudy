from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

from tv07_ocr.worker import (
    _compose_formula_text,
    _has_answer_blank,
    _recognize,
    _safe_recognize,
)


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

    def recognize(self, _: Any) -> Any:
        return self._output


class WorkerTests(unittest.TestCase):
    def test_formula_composer_keeps_question_prefix_and_blank_answer(self) -> None:
        image = Image.new("RGB", (1600, 212), "white")
        ImageDraw.Draw(image).line((1100, 190, 1500, 190), fill="black", width=3)

        text = _compose_formula_text(
            r"\lim_{x\to0}\left(1+x\right)=e^3,\quad\lim_{x\to0}\left(1+x\right)=e^3",
            [{"text": "1 设 lim 则", "confidence": 0.9}],
            image,
        )

        self.assertTrue(_has_answer_blank(image))
        self.assertTrue(text.startswith("1 设 "))
        self.assertTrue(text.endswith("=_____"))

    def test_formula_composer_detects_answer_rule_on_formula_baseline(self) -> None:
        image = Image.new("RGB", (573, 76), "white")
        ImageDraw.Draw(image).line((402, 43, 475, 43), fill="black", width=1)

        text = _compose_formula_text(
            r"\lim_{x\to0}\left(1+x\right)=e^3,\quad\lim_{x\to0}\left(1+x\right)=e^x",
            [{"text": "f(x) 1+x 1 设 则", "confidence": 0.9}],
            image,
        )

        self.assertTrue(_has_answer_blank(image))
        self.assertTrue(text.startswith("1 设 "))
        self.assertIn("，则", text)
        self.assertTrue(text.endswith("=_____"))

    def test_formula_composer_detects_answer_rule_above_crop_midpoint(self) -> None:
        image = Image.new("RGB", (1600, 475), "white")
        ImageDraw.Draw(image).line((830, 145, 960, 145), fill="black", width=2)

        text = _compose_formula_text(
            r"\lim_{x\to0}\left(1+x\right)=e^3,\quad\lim_{x\to0}\left(1+x\right)=e^3",
            [{"text": "1 第", "confidence": 0.9}],
            image,
        )

        self.assertTrue(_has_answer_blank(image))
        self.assertTrue(text.startswith("1 设 "))
        self.assertTrue(text.endswith("=_____"))

    def test_recognize_returns_normalized_box_without_input_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            image_path = Path(temporary_directory) / "source.png"
            Image.new("RGB", (100, 200), "white").save(image_path)
            result = _recognize(
                FakeEngine(
                    FakeOutput(
                        boxes=[[[80, 160], [480, 160], [480, 640], [80, 640]]],
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
