from __future__ import annotations

import unittest

from PIL import Image

from tv07_ocr.pipeline import prepare_document_image, sort_backend_lines


class PipelineTests(unittest.TestCase):
    def test_upscales_small_document_without_changing_aspect_ratio(self) -> None:
        prepared, report = prepare_document_image(Image.new("RGB", (300, 400), "white"))

        self.assertEqual(prepared.size, (1200, 1600))
        self.assertTrue(report.upscaled)
        self.assertFalse(report.inverted)

    def test_inverts_dark_scan_and_preserves_dimensions(self) -> None:
        prepared, report = prepare_document_image(Image.new("RGB", (1600, 1000), "black"))

        self.assertEqual(prepared.size, (1600, 1000))
        self.assertTrue(report.inverted)
        self.assertEqual(prepared.getpixel((0, 0)), (255, 255, 255))

    def test_sorts_lines_top_to_bottom_then_left_to_right(self) -> None:
        lines = [
            {
                "box": {"x": 0.7, "y": 0.2, "width": 0.1, "height": 0.03},
                "text": "right",
                "confidence": 0.9,
            },
            {
                "box": {"x": 0.1, "y": 0.2, "width": 0.1, "height": 0.03},
                "text": "left",
                "confidence": 0.9,
            },
            {
                "box": {"x": 0.1, "y": 0.1, "width": 0.1, "height": 0.03},
                "text": "top",
                "confidence": 0.9,
            },
        ]

        self.assertEqual(
            [line["text"] for line in sort_backend_lines(lines)],
            ["top", "left right"],
        )

    def test_merges_vertically_overlapping_formula_fragments(self) -> None:
        merged = sort_backend_lines(
            [
                {
                    "box": {"x": 0.1, "y": 0.2, "width": 0.1, "height": 0.04},
                    "text": "lim",
                    "confidence": 0.9,
                },
                {
                    "box": {"x": 0.2, "y": 0.21, "width": 0.1, "height": 0.03},
                    "text": "f(x)",
                    "confidence": 0.8,
                },
            ]
        )

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["text"], "lim f(x)")
        self.assertAlmostEqual(merged[0]["confidence"], 0.85)


if __name__ == "__main__":
    unittest.main()
