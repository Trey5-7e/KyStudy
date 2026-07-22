import { describe, expect, it } from "vitest";

import { joinPdfTextItems } from "./pdfTextItems";

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
