import { describe, expect, it, vi } from "vitest";

vi.mock("../library/pdf/pdfEngine", () => ({ openPdf: vi.fn() }));
vi.mock("../library/pdf/rangeSource", () => ({
  HttpRangeSource: class HttpRangeSource {},
}));
vi.mock("../../shared/tauri/resourceClient", () => ({
  buildResourceProtocolUrl: vi.fn(() => "kystudy-pdf://test"),
}));

import { openPdf } from "../library/pdf/pdfEngine";

import {
  analyzeWorkbookPdf,
  classifyHeading,
  detectQuestionNumberStyle,
  detectSubjects,
  findQuestionMarkers,
  inferQuestionType,
  inferQuestionVerticalBounds,
  ocrRecognitionToPageItems,
  pageNeedsOcr,
  parseQuestionNumber,
} from "./pdfQuestionIndexer";

describe("PDF question indexer", () => {
  it("recognizes a left-margin top-level Arabic question number", () => {
    expect(parseQuestionNumber("（13）曲线的全长", 0.12)).toBe("13");
  });

  it("recognizes decimal question numbers in common PDF spellings", () => {
    expect(parseQuestionNumber("1. 函数的定义域", 0.08)).toBe("1");
    expect(parseQuestionNumber("1．函数的定义域", 0.08)).toBe("1");
    expect(parseQuestionNumber("1、函数的定义域", 0.08)).toBe("1");
    expect(parseQuestionNumber("1 函数的定义域", 0.08)).toBeUndefined();
  });

  it("does not mistake a formula near the left content edge for a question number", () => {
    expect(parseQuestionNumber("1.217x + 1", 0.217)).toBeUndefined();
    expect(parseQuestionNumber("x≈0.217", 0.217)).toBeUndefined();
    expect(parseQuestionNumber("1. 函数的定义域", 0.217)).toBeUndefined();
    expect(parseQuestionNumber("1. 函数的定义域", 0.141)).toBeUndefined();
    expect(parseQuestionNumber("1. 函数的定义域", 0.14)).toBe("1");
  });

  it("requires punctuation or text context for a decimal marker", () => {
    const isolated = [{ text: "1", x: 0.12, top: 0.1 }];

    expect(parseQuestionNumber("1", 0.12)).toBeUndefined();
    expect(detectQuestionNumberStyle(isolated)).toBe("parenthesized");
    expect(findQuestionMarkers(isolated)).toEqual([]);
  });

  it("does not create an anchor for an unpunctuated number followed by prose", () => {
    expect(
      findQuestionMarkers([{ text: "1 函数的定义域", x: 0.08, top: 0.1 }]),
    ).toEqual([]);
  });

  it("does not treat an indented expression as a top-level question", () => {
    expect(parseQuestionNumber("(3) 子式", 0.4)).toBeUndefined();
    expect(parseQuestionNumber("(3) 子式", 0.2)).toBe("3");
    expect(parseQuestionNumber("(3) 子式", 0.221)).toBeUndefined();
  });

  it("detects decimal numbering and ignores parenthesized subquestions", () => {
    const items = [
      { text: "1.", x: 0.08, top: 0.1 },
      { text: "(1)", x: 0.12, top: 0.14 },
      { text: "2．", x: 0.08, top: 0.3 },
      { text: "(2)", x: 0.12, top: 0.34 },
    ];

    expect(detectQuestionNumberStyle(items)).toBe("decimal");
    expect(findQuestionMarkers(items)).toEqual([
      { item: items[0], number: "1" },
      { item: items[2], number: "2" },
    ]);
  });

  it("reconstructs a decimal marker split across adjacent PDF text items", () => {
    const opening = { text: "1", x: 0.08, top: 0.1 };
    expect(
      findQuestionMarkers([
        opening,
        { text: ".", x: 0.094, top: 0.1 },
        { text: "函数的定义域", x: 0.12, top: 0.1 },
      ]),
    ).toEqual([{ item: opening, number: "1" }]);
  });

  it("keeps parenthesized numbering as a backwards-compatible fallback", () => {
    const items = [
      { text: "(1)", x: 0.08, top: 0.1 },
      { text: "first question", x: 0.14, top: 0.14 },
      { text: "(2)", x: 0.08, top: 0.3 },
      { text: "second question", x: 0.14, top: 0.34 },
    ];

    expect(detectQuestionNumberStyle(items)).toBe("parenthesized");
    expect(findQuestionMarkers(items)).toEqual([
      { item: items[0], number: "1" },
      { item: items[2], number: "2" },
    ]);
  });

  it("reconstructs a question number split into three PDF text items", () => {
    const opening = { text: "(", x: 0.121, top: 0.154 };

    expect(
      findQuestionMarkers([
        opening,
        { text: "13", x: 0.128, top: 0.154 },
        { text: ")", x: 0.145, top: 0.154 },
        { text: "题干", x: 0.16, top: 0.154 },
      ]),
    ).toEqual([{ item: opening, number: "13" }]);
  });

  it("maps section headings to stable section metadata", () => {
    expect(classifyHeading("基础部分")).toEqual({ sectionPart: "basic" });
    expect(classifyHeading("强化部分")).toEqual({
      sectionPart: "comprehensive",
    });
    expect(classifyHeading("二、填空题")).toEqual({ questionType: "blank" });
  });

  it("keeps a full chapter title when its whitespace is irregular", () => {
    expect(classifyHeading("第一章   函数、极限、连续")).toEqual({
      chapter: "第一章 函数、极限、连续",
    });
  });

  it("infers question types from the question region when no heading is present", () => {
    expect(
      inferQuestionType([
        { text: "A. 0", x: 0.2, top: 0.1 },
        { text: "C. 1", x: 0.2, top: 0.14 },
      ]),
    ).toBe("choice");
    expect(
      inferQuestionType([{ text: "x = ________", x: 0.2, top: 0.1 }]),
    ).toBe("blank");

    for (const prompt of ["求 f(x)", "计算积分", "证明该命题", "解方程"]) {
      expect(inferQuestionType([{ text: prompt, x: 0.2, top: 0.1 }])).toBe(
        "solution",
      );
    }

    expect(
      inferQuestionType([{ text: "判断下列说法是否正确", x: 0.2, top: 0.1 }]),
    ).toBe("other");
  });

  it("keeps one root range when a descendant repeats the same subject name", () => {
    expect(
      detectSubjects(
        [
          { title: "线性代数篇", path: ["线性代数篇"], pageNumber: 2, top: 0 },
          {
            title: "概率论与数理统计篇",
            path: ["概率论与数理统计篇"],
            pageNumber: 46,
            top: 0,
          },
          {
            title: "概率论与数理统计",
            path: ["概率论与数理统计篇", "第二十一章"],
            pageNumber: 71,
            top: 0,
          },
        ],
        81,
      ),
    ).toEqual([
      expect.objectContaining({
        suggestedName: "线性代数",
        pageStart: 2,
        pageEnd: 45,
      }),
      expect.objectContaining({
        suggestedName: "概率论与数理统计",
        pageStart: 46,
        pageEnd: 81,
      }),
    ]);
  });

  it("recognizes a high-mathematics subject embedded in a source title", () => {
    expect(
      detectSubjects(
        [
          {
            title: "1000题数一高数篇",
            path: ["1000题数一高数篇"],
            pageNumber: 1,
            top: 0,
          },
        ],
        296,
        "1000题数一高数篇",
      ),
    ).toEqual([
      expect.objectContaining({
        suggestedName: "高等数学",
        pageStart: 1,
        pageEnd: 296,
      }),
    ]);
  });

  it("starts a titled high-mathematics range at the first outline page", () => {
    const subjects = detectSubjects(
      [
        {
          title: "第0章 零基础",
          path: ["第0章 零基础"],
          pageNumber: 3,
          top: 0,
        },
        {
          title: "第一章 函数、极限、连续",
          path: ["第一章 函数、极限、连续"],
          pageNumber: 9,
          top: 0,
        },
      ],
      296,
      "1000题数一高数篇",
    );

    expect(subjects).toEqual([
      expect.objectContaining({
        suggestedName: "高等数学",
        pageStart: 3,
        pageEnd: 296,
      }),
    ]);
  });

  it("splits a mixed linear-algebra/probability title at the probability chapter", () => {
    const sourceTitle = "1000题数一线概篇";
    const subjects = detectSubjects(
      [
        {
          title: "第一章 行列式",
          path: [sourceTitle, "第一章 行列式"],
          pageNumber: 3,
          top: 0,
        },
        {
          title: "第一章 随机事件与概率",
          path: [sourceTitle, "第一章 随机事件与概率"],
          pageNumber: 92,
          top: 0,
        },
        {
          title: "第6章 数理统计",
          path: [sourceTitle, "第6章 数理统计"],
          pageNumber: 144,
          top: 0,
        },
      ],
      214,
      sourceTitle,
    );

    expect(subjects).toEqual([
      expect.objectContaining({
        suggestedName: "线性代数",
        pageStart: 3,
        pageEnd: 91,
      }),
      expect.objectContaining({
        suggestedName: "概率论与数理统计",
        pageStart: 92,
        pageEnd: 214,
      }),
    ]);
  });

  it("starts a matrix question above its printed number and stops the previous question before it", () => {
    expect(
      inferQuestionVerticalBounds(
        [
          { text: "(2)", x: 0.08, top: 0.12, height: 0.02 },
          { text: "a+b", x: 0.3, top: 0.1, height: 0.04 },
          { text: "matrix", x: 0.28, top: 0.3, height: 0.12 },
          { text: "(3)", x: 0.08, top: 0.39, height: 0.02 },
        ],
        [0.12, 0.39],
      ),
    ).toEqual([
      { top: 0.094, bottom: 0.218 },
      { top: 0.294, bottom: 0.438 },
    ]);
  });

  it("uses the blank gap between questions as the split boundary", () => {
    const bounds = inferQuestionVerticalBounds(
      [
        { text: "(1)", x: 0.08, top: 0.1, height: 0.02 },
        { text: "first answer row", x: 0.12, top: 0.2, height: 0.02 },
        { text: "(2)", x: 0.08, top: 0.52, height: 0.02 },
        { text: "second answer row", x: 0.12, top: 0.62, height: 0.02 },
      ],
      [0.1, 0.52],
    );

    expect(bounds).toEqual([
      { top: 0.094, bottom: 0.368 },
      { top: 0.514, bottom: 0.658 },
    ]);
  });

  it("does not include the printed page footer in the final question", () => {
    const [bounds] = inferQuestionVerticalBounds(
      [
        { text: "(16)", x: 0.08, top: 0.62, height: 0.02 },
        { text: "option D", x: 0.12, top: 0.78, height: 0.02 },
        { text: "第 7 页，共 97 页", x: 0.4, top: 0.91, height: 0.02 },
      ],
      [0.62],
    );

    expect(bounds?.bottom).toBeCloseTo(0.818);
  });

  it("only requests OCR for sparse body text", () => {
    expect(
      pageNeedsOcr([
        { text: "第一道题目内容与条件", x: 0.1, top: 0.12 },
        { text: "第二道题目内容与条件", x: 0.1, top: 0.24 },
        { text: "第三道题目内容与条件", x: 0.1, top: 0.36 },
        { text: "第四道题目内容与条件", x: 0.1, top: 0.48 },
        { text: "第 1 页，共 4 页", x: 0.4, top: 0.94 },
      ]),
    ).toBe(false);
    expect(
      pageNeedsOcr([
        { text: "页眉", x: 0.2, top: 0.03 },
        { text: "第 1 页，共 4 页", x: 0.4, top: 0.94 },
      ]),
    ).toBe(true);
  });

  it("does not request OCR when sparse text has a reliable top-level marker", async () => {
    const page = fakePage([
      textValue("(1)", 0.14),
      textValue("扫描题目正文与条件", 0.2),
    ]);
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: fakeDocument(page),
      destroy: async () => undefined,
    });
    const recognizePage = vi.fn();

    const result = await analyzeWorkbookPdf(descriptor(), vi.fn(), {
      recognizePage,
      renderPage: vi.fn(),
    });

    expect(recognizePage).not.toHaveBeenCalled();
    expect(result[0]?.ocrPageCount).toBe(0);
    expect(result[0]?.questions).toHaveLength(1);
  });

  it("deduplicates ASCII and full-width OCR markers at the same position", () => {
    const textMarker = {
      text: "(1)",
      x: 0.08,
      top: 0.14,
      source: "text" as const,
    };
    const ocrMarker = {
      text: "（1）扫描题目",
      x: 0.097,
      top: 0.158,
      source: "ocr" as const,
    };

    expect(findQuestionMarkers([textMarker, ocrMarker])).toEqual([
      { item: textMarker, number: "1" },
    ]);
  });

  it("keeps same-number questions on one page unique and stable across reruns", async () => {
    const textItems = [
      textValue("(1)", 0.12),
      textValue("第一道题正文", 0.18),
      textValue("(1)", 0.52),
      textValue("第二道题正文", 0.58),
    ];
    const recognizePage = vi.fn();
    const run = async () => {
      vi.mocked(openPdf).mockResolvedValueOnce({
        document: fakeDocument(fakePage(textItems)),
        destroy: async () => undefined,
      });
      return analyzeWorkbookPdf(descriptor(), vi.fn(), { recognizePage });
    };

    const first = await run();
    const second = await run();
    const firstKeys = first[0]!.questions.map((question) => question.sourceKey);
    const secondKeys = second[0]!.questions.map(
      (question) => question.sourceKey,
    );

    expect(first[0]?.questions).toHaveLength(2);
    expect(new Set(firstKeys).size).toBe(2);
    expect(firstKeys).toEqual(secondKeys);
    expect(firstKeys[0]).toBe("未分章|other|other|1|1");
    expect(firstKeys[1]).toBe("未分章|other|other|1|1|2");
    expect(recognizePage).not.toHaveBeenCalled();
  });

  it("caps continuation regions at the backend limit and records a warning", async () => {
    const pages = [
      fakePage([textValue("(1)", 0.12), textValue("第一题正文", 0.18)]),
      ...Array.from({ length: 13 }, (_, index) =>
        fakePage([textValue(`跨页继续内容${index + 1}`, 0.2)]),
      ),
    ];
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: fakeDocumentPages(pages),
      destroy: async () => undefined,
    });

    const result = await analyzeWorkbookPdf(descriptor(pages.length), vi.fn());

    expect(result[0]?.questions[0]?.regions).toHaveLength(12);
    expect(result[0]?.warningCount).toBeGreaterThan(0);
  });

  it("truncates only oversized chapter labels to the backend byte limit", async () => {
    const longChapter = `第一章 ${"章节".repeat(100)}`;
    const page = fakePage([
      textValue(longChapter, 0.08),
      textValue("(1)", 0.2),
      textValue("题目正文", 0.26),
    ]);
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: fakeDocument(page),
      destroy: async () => undefined,
    });

    const result = await analyzeWorkbookPdf(descriptor(), vi.fn());
    const question = result[0]?.questions[0];
    expect(question).toBeDefined();
    if (question === undefined) return;

    expect(
      new TextEncoder().encode(question.chapter).length,
    ).toBeLessThanOrEqual(120);
    expect(question.chapter.startsWith("第一章")).toBe(true);
    expect(
      new TextEncoder().encode(question.sourceKey).length,
    ).toBeLessThanOrEqual(500);
  });

  it("maps full-page OCR lines to PageItems with source and confidence", () => {
    expect(
      ocrRecognitionToPageItems({
        lines: [
          {
            text: "（1）扫描题",
            confidence: 0.61,
            x: 0.08,
            y: 0.14,
            width: 0.5,
            height: 0.04,
          },
          {
            text: "",
            confidence: 0.9,
            x: 0,
            y: 0,
            width: 0.1,
            height: 0.1,
          },
        ] as never,
      }),
    ).toEqual([
      {
        text: "（1）扫描题",
        x: 0.08,
        top: 0.14,
        height: 0.04,
        source: "ocr",
        confidence: 0.61,
      },
    ]);
  });

  it("uses the injected OCR adapter only for a sparse page", async () => {
    const page = fakePage([]);
    const document = fakeDocument(page);
    vi.mocked(openPdf).mockResolvedValueOnce({
      document,
      destroy: async () => undefined,
    });
    const recognizePage = vi.fn().mockResolvedValue({
      pageNumber: 1,
      engine: "test-ocr",
      meanConfidence: 0.61,
      lines: [
        {
          text: "（1）扫描题目内容与条件",
          confidence: 0.61,
          x: 0.08,
          y: 0.14,
          width: 0.6,
          height: 0.04,
          sortOrder: 0,
        },
      ],
    });
    const result = await analyzeWorkbookPdf(descriptor(), vi.fn(), {
      recognizePage,
      renderPage: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    });

    expect(recognizePage).toHaveBeenCalledOnce();
    expect(result[0]?.ocrPageCount).toBe(1);
    expect(result[0]?.questions[0]?.indexConfidence).toBeLessThanOrEqual(0.72);
  });

  it("does not call OCR when the text layer is sufficiently populated", async () => {
    const textItems = [
      textValue("第一道题目内容与条件", 0.12),
      textValue("第二道题目内容与条件", 0.24),
      textValue("第三道题目内容与条件", 0.36),
      textValue("第四道题目内容与条件", 0.48),
    ];
    const page = fakePage(textItems);
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: fakeDocument(page),
      destroy: async () => undefined,
    });
    const recognizePage = vi.fn();

    const result = await analyzeWorkbookPdf(descriptor(), vi.fn(), {
      recognizePage,
      renderPage: vi.fn(),
    });

    expect(recognizePage).not.toHaveBeenCalled();
    expect(result[0]?.ocrPageCount).toBe(0);
  });

  it("stops before opening the PDF when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      analyzeWorkbookPdf(descriptor(), vi.fn(), { signal: controller.signal }),
    ).rejects.toThrowError("PDF_INDEX_CANCELED");
  });
});

function descriptor(pageCount = 1) {
  return {
    documentId: "019f7328-4b66-7613-9729-e3570fc41525",
    title: "scan.pdf",
    kind: "pdf" as const,
    mimeType: "application/pdf",
    sizeBytes: 100,
    pageCount,
  };
}

function fakePage(items: unknown[]) {
  return {
    getViewport: () => ({ width: 100, height: 100 }),
    getTextContent: async () => ({ items }),
    cleanup: vi.fn(),
  } as never;
}

function fakeDocument(page: never) {
  return {
    numPages: 1,
    getOutline: async () => null,
    getPage: vi.fn().mockResolvedValue(page),
  } as never;
}

function fakeDocumentPages(pages: never[]) {
  return {
    numPages: pages.length,
    getOutline: async () => null,
    getPage: vi.fn((pageNumber: number) =>
      Promise.resolve(pages[pageNumber - 1]),
    ),
  } as never;
}

function textValue(str: string, top: number) {
  return {
    str,
    transform: [1, 0, 0, 1, 8, 100 - top * 100 - 4],
    height: 4,
  };
}
