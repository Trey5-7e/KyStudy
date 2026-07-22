from __future__ import annotations

import unittest

from tv07_ocr.metrics import character_error_rate, edit_distance, keyword_recall, normalize_text


class MetricsTests(unittest.TestCase):
    def test_normalize_text_removes_spacing_and_punctuation(self) -> None:
        self.assertEqual(normalize_text("数据结构：树、图"), "数据结构树图")

    def test_edit_distance_counts_substitution(self) -> None:
        self.assertEqual(edit_distance("缓存", "缓荐"), 1)

    def test_character_error_rate_is_zero_for_equal_normalized_text(self) -> None:
        self.assertEqual(character_error_rate("TCP / IP", "tcp/ip"), 0)

    def test_keyword_recall_counts_normalized_matches(self) -> None:
        self.assertEqual(keyword_recall(["数据结构", "虚拟内存"], "数据结构与进程"), 0.5)


if __name__ == "__main__":
    unittest.main()
