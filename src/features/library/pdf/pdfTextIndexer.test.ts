import { describe, expect, it } from "vitest";

import { joinPdfTextItems } from "./pdfTextItems";
import {
  mergeIndexedText,
  selectOcrLinesForIndex,
  shouldRequestPdfOcr,
} from "./pdfTextIndexerModel";

describe("PDF text item joining", () => {
  it("keeps adjacent Chinese text searchable without inserted spaces", () => {
    expect(
      joinPdfTextItems([
        { str: "数据", hasEOL: false },
        { str: "结构", hasEOL: false },
        { str: "。", hasEOL: true },
      ]),
    ).toBe("数据结构。");
  });

  it("separates adjacent Latin words", () => {
    expect(
      joinPdfTextItems([
        { str: "operating", hasEOL: false },
        { str: "system", hasEOL: false },
      ]),
    ).toBe("operating system");
  });

  it("ignores marked-content entries without text", () => {
    expect(
      joinPdfTextItems([
        { type: "beginMarkedContent", id: "tag" },
        { str: "正文", hasEOL: false },
      ]),
    ).toBe("正文");
  });
});

describe("PDF OCR fallback", () => {
  it("requests OCR for an effectively empty text layer", () => {
    expect(shouldRequestPdfOcr("第 1 页")).toBe(true);
  });

  it("keeps a usable text layer when OCR repeats existing lines", () => {
    expect(mergeIndexedText("第 1 题\n求极限", "第1题\n求极限")).toBe(
      "第 1 题\n求极限",
    );
  });

  it("uses OCR text when the PDF has no text layer", () => {
    expect(mergeIndexedText("", "（1）扫描题目")).toBe("（1）扫描题目");
  });

  it("prefers reliable OCR lines but keeps a fully low-confidence page as fallback", () => {
    expect(
      selectOcrLinesForIndex([
        { text: "低可信噪声", confidence: 0.2 },
        { text: "可靠正文", confidence: 0.91 },
      ]),
    ).toEqual([{ text: "可靠正文", confidence: 0.91 }]);
    expect(
      selectOcrLinesForIndex([{ text: "扫描正文", confidence: 0.2 }]),
    ).toEqual([{ text: "扫描正文", confidence: 0.2 }]);
  });
});
