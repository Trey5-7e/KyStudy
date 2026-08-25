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

  it("recognizes bracketed and closing-parenthesis question numbers", () => {
    expect(parseQuestionNumber("【13】曲线的全长", 0.12)).toBe("13");
    expect(parseQuestionNumber("13）曲线的全长", 0.08)).toBe("13");
    expect(parseQuestionNumber("13) curve length", 0.08)).toBe("13");
  });

  it("recognizes decimal question numbers in common PDF spellings", () => {
    expect(parseQuestionNumber("1. 函数的定义域", 0.08)).toBe("1");
    expect(parseQuestionNumber("1．函数的定义域", 0.08)).toBe("1");
    expect(parseQuestionNumber("1、函数的定义域", 0.08)).toBe("1");
    expect(parseQuestionNumber("1: 函数的定义域", 0.08)).toBe("1");
    expect(parseQuestionNumber("1： 函数的定义域", 0.08)).toBe("1");
  });

  it("recognizes plain leading question numbers in text and math formats", () => {
    expect(parseQuestionNumber("1 设 lim", 0.08)).toBe("1");
    expect(parseQuestionNumber("3 limx→+∞", 0.08)).toBe("3");
    expect(parseQuestionNumber("4 I = lim", 0.08)).toBe("4");
    expect(parseQuestionNumber("11 [x] 表示", 0.08)).toBe("11");
    expect(parseQuestionNumber("43I = \int", 0.08)).toBe("43");
    expect(parseQuestionNumber("48f(x) = 1", 0.08)).toBe("48");
    expect(parseQuestionNumber("100 已知函数", 0.08)).toBe("100");
    expect(parseQuestionNumber("108 \iint", 0.08)).toBe("108");
    expect(parseQuestionNumber("132 \sum", 0.08)).toBe("132");
    expect(parseQuestionNumber("360 函数", 0.08)).toBe("360");
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

  it("creates an anchor for an unpunctuated number followed by prose", () => {
    expect(
      findQuestionMarkers([{ text: "1 函数的定义域", x: 0.08, top: 0.1 }]),
    ).toEqual([
      {
        item: { text: "1 函数的定义域", x: 0.08, top: 0.1 },
        number: "1",
      },
    ]);
  });

  it("recognizes unpunctuated question numbers in generic and specialized profiles", () => {
    const items = [
      { text: "1 设函数f(x)在区间上连续", x: 0.08, top: 0.1 },
      { text: "161 设数列满足条件", x: 0.08, top: 0.3 },
    ];

    expect(parseQuestionNumber(items[0]!.text, items[0]!.x)).toBe("1");
    expect(findQuestionMarkers(items)).toEqual([
      { item: items[0], number: "1" },
      { item: items[1], number: "161" },
    ]);
  });

  it("recognizes a plain number split from its question body", () => {
    const marker = { text: "1", x: 0.08, top: 0.1 };
    const body = { text: "在区间上讨论函数性质", x: 0.12, top: 0.1 };

    expect(findQuestionMarkers([marker, body])).toEqual([
      { item: marker, number: "1" },
    ]);
  });

  it("keeps the plain marker style when the first page has no question marker", async () => {
    const pages = [
      fakePage([textValue("第一章 函数、极限、连续", 0.1)]),
      fakePage([
        textValue("A 类", 0.1),
        textValue("1在区间上讨论函数性质", 0.1),
        textValue("函数正文与条件", 0.18),
      ]),
    ];
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: fakeDocumentPages(pages),
      destroy: async () => undefined,
    });

    const result = await analyzeWorkbookPdf(
      { ...descriptor(pages.length), title: "李艳芳900题数一高数题本.pdf" },
      vi.fn(),
      {
        profile: {
          id: "li-yanfang-900-shuyi-gaoshu",
          allowUnpunctuatedQuestionNumbers: true,
        },
      },
    );

    expect(result[0]?.questions).toHaveLength(1);
    expect(result[0]?.questions[0]?.questionNumber).toBe("1");
    expect(result[0]?.questions[0]?.sectionPart).toBe("basic");
    expect(result[0]?.profileId).toBe("li-yanfang-900-shuyi-gaoshu");
    expect(result[0]?.unresolvedMarkerCount).toBe(0);
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

  it("reconstructs a bracketed question number split across text items", () => {
    expect(
      findQuestionMarkers([
        { text: "【", x: 0.08, top: 0.154 },
        { text: "13", x: 0.087, top: 0.154 },
        { text: "】", x: 0.105, top: 0.154 },
        { text: "题干", x: 0.16, top: 0.154 },
      ]),
    ).toEqual([{ item: { text: "【", x: 0.08, top: 0.154 }, number: "13" }]);
  });

  it("maps section headings to stable section metadata", () => {
    expect(classifyHeading("基础部分")).toEqual({ sectionPart: "basic" });
    expect(classifyHeading("强化部分")).toEqual({
      sectionPart: "comprehensive",
    });
    expect(classifyHeading("二、填空题")).toEqual({ questionType: "blank" });
    expect(classifyHeading("强化篇")).toEqual({
      sectionPart: "comprehensive",
    });
    expect(classifyHeading("A 类")).toEqual({ sectionPart: "basic" });
    expect(classifyHeading("B类")).toEqual({
      sectionPart: "comprehensive",
    });
    expect(classifyHeading("C 类")).toEqual({ sectionPart: "extended" });
    expect(classifyHeading("第三篇 极限与连续")).toEqual({
      chapter: "第三篇 极限与连续",
    });
    expect(classifyHeading("计算题")).toEqual({ questionType: "solution" });
    expect(classifyHeading("选择部分")).toEqual({ questionType: "choice" });
    expect(classifyHeading("填空部分")).toEqual({ questionType: "blank" });
    expect(classifyHeading("解答部分")).toEqual({ questionType: "solution" });
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

  it("rejects zero as a question number in every marker style", () => {
    expect(parseQuestionNumber("0.", 0.12)).toBeUndefined();
    expect(parseQuestionNumber("(0) 题干", 0.12)).toBeUndefined();
    expect(
      findQuestionMarkers([
        { text: "0", x: 0.121, top: 0.389 },
        { text: "处连续", x: 0.133, top: 0.389 },
      ]),
    ).toEqual([]);
  });

  it("drops wrapped-line phantom markers that break numbering order", async () => {
    const pages = [
      fakePage([
        textValueWithX("13", 0.12, 12.1),
        textValueWithX("已知函数", 0.12, 14.2),
        textValueWithX("10", 0.3, 12.1),
        textValueWithX("处连续", 0.3, 13.3),
        textValueWithX("14", 0.55, 12.1),
        textValueWithX("设函数", 0.55, 14.2),
      ]),
    ];
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: fakeDocumentPages(pages),
      destroy: async () => undefined,
    });

    const result = await analyzeWorkbookPdf(descriptor(pages.length), vi.fn());

    expect(result[0]?.questions.map((q) => q.questionNumber)).toEqual([
      "13",
      "14",
    ]);
  });

  it("keeps restarted numbering when an outline subsection changes context", async () => {
    const pages = [
      fakePage([
        textValueWithX("第2章 矩阵", 0.06, 20),
        textValueWithX("1", 0.15, 12.1),
        textValueWithX("设矩阵", 0.15, 14.2),
        textValueWithX("2", 0.3, 12.1),
        textValueWithX("设矩阵", 0.3, 14.2),
        textValueWithX("强化部分 - 矩阵运算", 0.5, 20),
        textValueWithX("1", 0.65, 12.1),
        textValueWithX("设矩阵", 0.65, 14.2),
        textValueWithX("2", 0.8, 12.1),
        textValueWithX("设矩阵", 0.8, 14.2),
      ]),
    ];
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: fakeDocumentWithOutline(pages, [
        { title: "第2章 矩阵", pageNumber: 1, top: 0.05 },
        { title: "强化部分 - 矩阵运算", pageNumber: 1, top: 0.45 },
      ]),
      destroy: async () => undefined,
    });

    const result = await analyzeWorkbookPdf(descriptor(pages.length), vi.fn());

    expect(result[0]?.questions.map((q) => q.questionNumber)).toEqual([
      "1",
      "2",
      "1",
      "2",
    ]);
    expect(result[0]?.questions.map((q) => q.chapter)).toEqual([
      "第2章 矩阵",
      "第2章 矩阵",
      "第2章 矩阵·矩阵运算",
      "第2章 矩阵·矩阵运算",
    ]);
    expect(result[0]?.questions.map((q) => q.sectionPart)).toEqual([
      "other",
      "other",
      "comprehensive",
      "comprehensive",
    ]);
  });

  it("uses bookmark topic titles as chapters when no heading rule matches", async () => {
    const pages = [
      fakePage([
        textValueWithX("行列式", 0.08, 12.1),
        textValueWithX("1", 0.2, 12.1),
        textValueWithX("计算行列式", 0.2, 14.2),
      ]),
    ];
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: fakeDocumentWithOutline(pages, [
        { title: "线代 · 填空题", pageNumber: 1, top: 0.04 },
        { title: "行列式", pageNumber: 1, top: 0.07 },
      ]),
      destroy: async () => undefined,
    });

    const result = await analyzeWorkbookPdf(descriptor(pages.length), vi.fn());

    expect(result[0]?.questions).toHaveLength(1);
    expect(result[0]?.questions[0]?.chapter).toBe("行列式");
  });

  it("recognizes standalone topic chapters even without bookmarks", async () => {
    const pages = [
      fakePage([
        textValueWithX("假设检验", 0.08, 12.1),
        textValueWithX("1", 0.2, 12.1),
        textValueWithX("设显著水平", 0.2, 14.2),
      ]),
    ];
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: fakeDocumentPages(pages),
      destroy: async () => undefined,
    });

    const result = await analyzeWorkbookPdf(descriptor(pages.length), vi.fn());

    expect(result[0]?.questions).toHaveLength(1);
    expect(result[0]?.questions[0]?.chapter).toBe("假设检验");
  });

  it("classifies part-prefixed chapters, subsections, and test papers", () => {
    expect(classifyHeading("强化篇第8章 统计量及其分布")).toEqual({
      chapter: "第8章 统计量及其分布",
      sectionPart: "comprehensive",
    });
    expect(classifyHeading("基础篇第1章 行列式")).toEqual({
      chapter: "第1章 行列式",
      sectionPart: "basic",
    });
    expect(classifyHeading("强化部分 - 矩阵运算")).toEqual({
      sectionPart: "comprehensive",
      subChapter: "矩阵运算",
    });
    expect(classifyHeading("测试卷二")).toEqual({ subChapter: "测试卷二" });
  });

  it("caps continuation regions at the backend limit and records a warning", async () => {
    const pages = [
      fakePage([textValue("(1)", 0.12), textValue("第一题正文", 0.85)]),
      ...Array.from({ length: 13 }, (_, index) =>
        fakePage([textValue(`跨页继续内容${index + 1}`, 0.85)]),
      ),
    ];
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: fakeDocumentPages(pages),
      destroy: async () => undefined,
    });

    const result = await analyzeWorkbookPdf(descriptor(pages.length), vi.fn());

    expect(result[0]?.questions[0]?.regions).toHaveLength(12);
    expect(result[0]?.warningCount).toBeGreaterThan(0);
    expect(result[0]?.crossPageQuestionCount).toBe(1);
  });

  it("does not create a cross-page continuation when previous question finished before page bottom", async () => {
    const pages = [
      fakePage([textValue("(1)", 0.12), textValue("第一题正文", 0.35)]),
      fakePage([
        textValue("一、选择题", 0.08),
        textValue("(2)", 0.18),
        textValue("第二题正文", 0.28),
      ]),
    ];
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: fakeDocumentPages(pages),
      destroy: async () => undefined,
    });

    const result = await analyzeWorkbookPdf(descriptor(pages.length), vi.fn());

    expect(result[0]?.questions).toHaveLength(2);
    expect(result[0]?.questions[0]?.regions).toHaveLength(1);
    expect(result[0]?.questions[1]?.regions).toHaveLength(1);
    expect(result[0]?.crossPageQuestionCount).toBe(0);
  });

  it("does not attach section heading on next page to previous question", async () => {
    const pages = [
      fakePage([textValue("(1)", 0.12), textValue("第一题正文", 0.85)]),
      fakePage([
        textValue("第二章 导数与微分", 0.06),
        textValue("(2)", 0.2),
        textValue("第二题正文", 0.3),
      ]),
    ];
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: fakeDocumentPages(pages),
      destroy: async () => undefined,
    });

    const result = await analyzeWorkbookPdf(descriptor(pages.length), vi.fn());

    expect(result[0]?.questions).toHaveLength(2);
    expect(result[0]?.questions[0]?.regions).toHaveLength(1);
    expect(result[0]?.questions[1]?.regions).toHaveLength(1);
    expect(result[0]?.crossPageQuestionCount).toBe(0);
  });

  it("reports pages with body text but no question marker", async () => {
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: fakeDocument(
        fakePage([
          textValue("本页只有无法定位题号的正文", 0.12),
          textValue("请人工复核这一页", 0.2),
        ]),
      ),
      destroy: async () => undefined,
    });

    const result = await analyzeWorkbookPdf(descriptor(), vi.fn());

    expect(result[0]?.questions).toHaveLength(0);
    expect(result[0]?.unresolvedMarkerCount).toBe(1);
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

  it("drops low-confidence OCR noise when a reliable line is available", () => {
    expect(
      ocrRecognitionToPageItems({
        lines: [
          {
            text: "噪声",
            confidence: 0.12,
            x: 0.1,
            y: 0.1,
            width: 0.1,
            height: 0.03,
            sortOrder: 0,
          },
          {
            text: "可靠题干",
            confidence: 0.88,
            x: 0.1,
            y: 0.2,
            width: 0.4,
            height: 0.04,
            sortOrder: 1,
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({ text: "可靠题干", confidence: 0.88 }),
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

  it("indexes two-column pages in correct reading order and sets column regions", async () => {
    const pages = [
      fakePage([
        textValueWithX("第三章 一元函数积分学", 0.04, 8),
        textValueWithX("二、填空题", 0.08, 44),
        textValueWithX("11.", 0.1, 44),
        textValueWithX("第11题填空题正文", 0.13, 44),
        textValueWithX("一、选择题", 0.12, 8),
        textValueWithX("1.", 0.15, 8),
        textValueWithX("第1题选择题正文", 0.19, 8),
        textValueWithX("2.", 0.35, 8),
        textValueWithX("第2题选择题正文", 0.4, 8),
        textValueWithX("13.", 0.34, 44),
        textValueWithX("第13题填空题正文", 0.38, 44),
      ]),
    ];
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: fakeDocumentPages(pages),
      destroy: async () => undefined,
    });

    const result = await analyzeWorkbookPdf(descriptor(pages.length), vi.fn());

    expect(result[0]?.questions).toHaveLength(4);
    const questions = result[0]?.questions ?? [];
    expect(questions.map((q) => q.questionNumber)).toEqual([
      "1",
      "2",
      "11",
      "13",
    ]);
    expect(questions[0]?.questionType).toBe("choice");
    expect(questions[1]?.questionType).toBe("choice");
    expect(questions[2]?.questionType).toBe("blank");
    expect(questions[3]?.questionType).toBe("blank");
    expect(questions[0]?.regions[0]?.x).toBeCloseTo(0.04, 2);
    expect(questions[2]?.regions[0]?.width).toBeCloseTo(0.46, 2);
    expect(questions[3]?.regions[0]?.x).toBeCloseTo(0.5, 2);
  });

  it("runs against real 880 sample", async () => {
    const fs = await import("fs");
    const pdfPath =
      "C:/Users/Administrator/Desktop/考研/数学/880/880数一高数篇做题本.pdf";
    if (!fs.existsSync(pdfPath)) return;
    const bytes = new Uint8Array(fs.readFileSync(pdfPath));
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: doc as never,
      destroy: async () => undefined,
    });
    const results = await analyzeWorkbookPdf(
      {
        documentId: "real-880",
        title: "880高数篇做题本.pdf",
        kind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
        pageCount: doc.numPages,
      },
      () => undefined,
    );
    const allQuestions = results[0]?.questions ?? [];
    const ch1 = allQuestions.filter(
      (q) => (q.regions[0]?.pageNumber ?? 0) <= 11,
    );
    expect(ch1.length).toBe(56);
    expect(allQuestions.length).toBe(658);
  }, 15000);

  it("runs against real 900 gaoshu sample", async () => {
    const fs = await import("fs");
    const pdfPath =
      "C:/Users/Administrator/Desktop/考研/数学/李艳芳900/【A4带空】27李艳芳900题数一高数题本.pdf";
    if (!fs.existsSync(pdfPath)) return;
    const bytes = new Uint8Array(fs.readFileSync(pdfPath));
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: doc as never,
      destroy: async () => undefined,
    });
    const results = await analyzeWorkbookPdf(
      {
        documentId: "real-900-gaoshu",
        title: "900数一高数做题本.pdf",
        kind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
        pageCount: doc.numPages,
      },
      () => undefined,
    );
    auditWorkbookResults(results, "900数一高数做题本.pdf");
  }, 30000);

  it("runs against real 900 xiandai sample", async () => {
    const fs = await import("fs");
    const pdfPath =
      "C:/Users/Administrator/Desktop/考研/数学/李艳芳900/【A4带空】27李艳芳900题数一线代概率题本.pdf";
    if (!fs.existsSync(pdfPath)) return;
    const bytes = new Uint8Array(fs.readFileSync(pdfPath));
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: doc as never,
      destroy: async () => undefined,
    });
    const results = await analyzeWorkbookPdf(
      {
        documentId: "real-900-xiandai",
        title: "900数一线代概率做题本.pdf",
        kind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
        pageCount: doc.numPages,
      },
      () => undefined,
    );
    auditWorkbookResults(results, "900数一线代概率做题本.pdf");
  }, 30000);

  it("runs against real 1000 gaoshu sample", async () => {
    const fs = await import("fs");
    const pdfPath =
      "C:/Users/Administrator/Desktop/考研/数学/1000题/【A4基础强化合并】1000题数一高数篇.pdf";
    if (!fs.existsSync(pdfPath)) return;
    const bytes = new Uint8Array(fs.readFileSync(pdfPath));
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: doc as never,
      destroy: async () => undefined,
    });
    const results = await analyzeWorkbookPdf(
      {
        documentId: "real-1000-gaoshu",
        title: "张宇1000题高数篇做题本.pdf",
        kind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
        pageCount: doc.numPages,
      },
      () => undefined,
    );
    auditWorkbookResults(results, "张宇1000题高数篇做题本.pdf");
  }, 30000);

  it("runs against real 1000 xiandai sample", async () => {
    const fs = await import("fs");
    const pdfPath =
      "C:/Users/Administrator/Desktop/考研/数学/1000题/【A4基础强化合并】1000题数一线概篇.pdf";
    if (!fs.existsSync(pdfPath)) return;
    const bytes = new Uint8Array(fs.readFileSync(pdfPath));
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    vi.mocked(openPdf).mockResolvedValueOnce({
      document: doc as never,
      destroy: async () => undefined,
    });
    const results = await analyzeWorkbookPdf(
      {
        documentId: "real-1000-xiandai",
        title: "张宇1000题线代概率做题本.pdf",
        kind: "pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
        pageCount: doc.numPages,
      },
      () => undefined,
    );
    auditWorkbookResults(results, "张宇1000题线代概率做题本.pdf");
  }, 30000);
});

function auditWorkbookResults(
  results: Awaited<ReturnType<typeof analyzeWorkbookPdf>>,
  title: string,
) {
  console.log(`\n======================================================`);
  console.log(`AUDIT: ${title}`);
  for (const res of results) {
    console.log(
      `Subject: ${res.suggestedName} | Total: ${res.questions.length}`,
    );
    const groups = new Map<string, typeof res.questions>();
    for (const q of res.questions) {
      const key = `${q.chapter} | part:${q.sectionPart ?? "none"} | type:${q.questionType ?? "none"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(q);
    }
    for (const [key, qList] of groups.entries()) {
      const nums = qList.map((q) => q.questionNumber);
      const pages = qList.map((q) => q.regions[0]?.pageNumber ?? 0);
      const minP = Math.min(...pages);
      const maxP = Math.max(...pages);
      const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
      let hasGaps = false;
      for (let i = 0; i < nums.length; i++) {
        if (Number(nums[i]) !== i + 1) {
          hasGaps = true;
          break;
        }
      }
      const status =
        dupes.length > 0
          ? `❌ DUPES [${dupes.join(",")}]`
          : hasGaps
            ? `⚠️ GAPS [${nums.slice(0, 10).join(",")}${nums.length > 10 ? "..." : ""}]`
            : `✅ 1..${nums.length}`;
      console.log(
        `  ${key} (p.${minP}-${maxP}, cnt:${qList.length}) -> ${status}`,
      );
      if (dupes.length > 0) {
        console.log(`    DUPE DETAILS for ${key}:`);
        for (const q of qList) {
          console.log(
            `      p.${q.regions[0]?.pageNumber} | num:${q.questionNumber} | ${q.title}`,
          );
        }
      }
    }
  }
}

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

function fakePage(items: Array<ReturnType<typeof textValue>>) {
  return {
    getViewport: () => ({ width: 100, height: 100 }),
    getTextContent: async () => ({ items }),
    cleanup: () => undefined,
  };
}

function fakeDocument(page: ReturnType<typeof fakePage>) {
  return {
    numPages: 1,
    getOutline: async () => null,
    getPage: vi.fn().mockResolvedValue(page),
  } as never;
}

function fakeDocumentPages(pages: Array<ReturnType<typeof fakePage>>) {
  return {
    numPages: pages.length,
    getOutline: async () => null,
    getPage: vi.fn((pageNumber: number) =>
      Promise.resolve(pages[pageNumber - 1]),
    ),
  } as never;
}

function fakeDocumentWithOutline(
  pages: Array<ReturnType<typeof fakePage>>,
  outline: Array<{ title: string; pageNumber: number; top: number }>,
) {
  return {
    numPages: pages.length,
    getOutline: async () =>
      outline.map((node) => ({
        title: node.title,
        dest: [
          { pageIndex: node.pageNumber - 1 },
          { name: null },
          {},
          (1 - node.top) * 100,
        ],
      })),
    getPageIndex: vi
      .fn()
      .mockImplementation(async (ref: { pageIndex: number }) => ref.pageIndex),
    getPage: vi.fn((pageNumber: number) =>
      Promise.resolve(pages[pageNumber - 1]),
    ),
  } as never;
}

function textValue(str: string, top: number) {
  return textValueWithX(str, top, 8);
}

function textValueWithX(str: string, top: number, x: number = 8) {
  return {
    str,
    transform: [1, 0, 0, 1, x, 100 - top * 100 - 4],
    height: 4,
  };
}
