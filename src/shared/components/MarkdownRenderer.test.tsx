import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  MarkdownRenderer,
  MARKDOWN_RENDERER_VERSION,
  markdownToPlainText,
  normalizeMathDelimiters,
  sanitizeMarkdownHref,
} from "./MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("renders Markdown and inline formulas through KaTeX HTML", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer
        source={
          "# 结论\n\n**加粗** 和$x^2$\n\n- 一\n- 二\n\n" +
          String.fromCharCode(96).repeat(3) +
          "ts\nconst x = 1;\n" +
          String.fromCharCode(96).repeat(3)
        }
      />,
    );
    expect(markup).toContain("<h1>");
    expect(markup).toContain(
      `data-renderer-version="${MARKDOWN_RENDERER_VERSION}"`,
    );
    expect(markup).toContain("<strong>");
    expect(markup).toContain('class="katex"');
    expect(markup).toContain('class="katex-html"');
    expect(markup).not.toContain("<script");
  });

  it("renders tables and display formulas", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer
        source={"| 项目 | 值 |\n| --- | --- |\n| 结论 | $x$ |\n\n$$\nx^2\n$$"}
      />,
    );
    expect(markup).toContain("<table>");
    expect(markup).toContain('class="katex-display"');
  });

  it("does not render raw HTML or unsafe images, but renders safe image data urls", () => {
    const markup = renderToStaticMarkup(
      <MarkdownRenderer
        source={
          "<script>alert(1)</script>\n\n![危险](javascript:alert(1))\n\n![安全图片](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)"
        }
      />,
    );
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("javascript:");
    expect(markup).toContain("<img");
    expect(markup).toContain('alt="安全图片"');
    expect(markup).toContain('class="markdown-rendered-image"');
  });

  it("normalizes provider TeX delimiters without touching code fences", () => {
    const source = [
      "正文 \\(x^2\\)",
      "",
      "\\[",
      "\\lim_{x\\to0}\\frac{1}{x}",
      "\\]",
      "",
      String.fromCharCode(96).repeat(3) + "text",
      "\\(not math\\)",
      String.fromCharCode(96).repeat(3),
    ].join("\n");
    const normalized = normalizeMathDelimiters(source);
    expect(normalized).toContain("$x^2$");
    expect(normalized).toContain("$$\n\\lim_{x\\to0}\\frac{1}{x}\n$$");
    expect(normalized).toContain("\\(not math\\)");
  });

  it("wraps bare TeX lines returned by AI providers", () => {
    const source = [
      "\\vec n_1=(1,-1,0),\\quad \\vec n_2=(0,2,1)",
      "",
      "3.交线方向向量为",
      "\\vec v_2=\\vec n_1\\times\\vec n_2=(1,1,-2)",
      "",
      "所以",
      "\\theta=\\frac{\\pi}{3}",
    ].join("\n");
    const normalized = normalizeMathDelimiters(source);
    const markup = renderToStaticMarkup(<MarkdownRenderer source={source} />);

    expect(normalized).toContain(
      "$$\n\\vec n_1=(1,-1,0),\\quad \\vec n_2=(0,2,1)\n$$",
    );
    expect(normalized).toContain(
      "$$\n\\vec v_2=\\vec n_1\\times\\vec n_2=(1,1,-2)\n$$",
    );
    expect(markup.match(/class="katex"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(markup).toContain('class="katex-html"');
  });

  it("keeps aligned TeX blocks and inline prose formulas renderable", () => {
    const source = [
      "由此可得 \\theta=\\frac{\\pi}{3}。",
      "\\begin{aligned}",
      "f(x)&=\\frac{1}{x}\\\\",
      "g(x)&=\\sqrt{x}",
      "\\end{aligned}",
    ].join("\n");
    const normalized = normalizeMathDelimiters(source);
    const markup = renderToStaticMarkup(<MarkdownRenderer source={source} />);

    expect(normalized).toContain("由此可得 $\\theta=\\frac{\\pi}{3}$。");
    expect(normalized).toContain("$$\n\\begin{aligned}");
    expect(normalized).toContain("\\end{aligned}\n$$");
    expect(markup).toContain('class="katex-display"');
    expect(markup).toContain('class="katex"');
  });

  it("renders multiple formulas embedded in one Chinese sentence", () => {
    const source =
      "已知 \\lim_{x\\to0}(1+x)^{1/x}=\\mathrm{e}，则 " +
      "\\lim_{x\\to0}(1+x)^{1/x}=\\mathrm{e}";
    const normalized = normalizeMathDelimiters(source);
    const markup = renderToStaticMarkup(<MarkdownRenderer source={source} />);

    expect(normalized.match(/\$\\lim/g)?.length).toBe(2);
    expect(markup.match(/class="katex"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("normalizes Chinese-quoted math spans from provider responses", () => {
    const source = [
      "第一项为‘a/2‘；第二项利用偶函数性质。",
      "易错点：不要误以为‘F(-x_0)=F(x_0)‘。",
    ].join("\n");
    const normalized = normalizeMathDelimiters(source);
    const markup = renderToStaticMarkup(<MarkdownRenderer source={source} />);

    expect(normalized).toContain("第一项为$a/2$；");
    expect(normalized).toContain("误以为$F(-x_0)=F(x_0)$。");
    expect(markup.match(/class="katex"/g)?.length).toBe(2);
  });

  it("recovers math syntax that was escaped twice by an API transport", () => {
    const source = [
      "1. \\$L_2\\$ 所在平面的法向量为",
      "\\\\vec v_1=(1,-2,1)",
      "\\\\vec v_2=\\\\vec n_1\\\\times\\\\vec n_2=(1,1,-2)",
    ].join("\n");
    const normalized = normalizeMathDelimiters(source);
    const markup = renderToStaticMarkup(<MarkdownRenderer source={source} />);

    expect(normalized).toContain("1. $L_2$ 所在平面的法向量为");
    expect(normalized).toContain("$$\n\\vec v_1=(1,-2,1)\n$$");
    expect(markup.match(/class="katex"/g)?.length).toBe(3);
  });

  it("renders long historical analyses with mixed prose and bare TeX", () => {
    const source = [
      "答案：C",
      "",
      "解题思路：利用偶函数在对称区间上的积分性质。",
      "",
      "因为 f(x) 为偶函数，且",
      "\\\\int_{-\\\\infty}^{+\\\\infty} f(x),dx=a",
      "",
      "所以",
      "\\\\int_{-\\\\infty}^{0} f(x),dx=\\\\frac a2",
      "",
      "由定义",
      "F(-x_0)=\\\\int_{-\\\\infty}^{-x_0} f(t),dt",
      "",
      "最终结论：",
      "\\\\boxed{F(-x_0)=\\\\frac a2-\\\\int_0^{x_0}f(x),dx}",
      "",
      "2. \\\\$L_2\\\\$ 所在平面的法向量为 \\\\vec n_1=(1,-1,0)",
      "夹角的余弦为 \\\\cos\\\\theta=\\\\frac{\\\\pi}{3}",
    ].join("\n");
    const normalized = normalizeMathDelimiters(source);
    const markup = renderToStaticMarkup(<MarkdownRenderer source={source} />);

    expect(normalized).toContain(
      "$$\n\\int_{-\\infty}^{+\\infty} f(x),dx=a\n$$",
    );
    expect(normalized).toContain(
      "$$\n\\boxed{F(-x_0)=\\frac a2-\\int_0^{x_0}f(x),dx}\n$$",
    );
    expect(normalized).toContain("2. $L_2$ 所在平面的法向量为");
    expect(markup.match(/class="katex"/g)?.length).toBeGreaterThanOrEqual(6);
    expect(markup).toContain('class="katex-display"');
  });

  it("renders indented provider display delimiters from persisted history", () => {
    const source = String.raw`答案：C

关键步骤：
1. 因为 f(x) 为偶函数，且  
   \[
   \int_{-\infty}^{+\infty} f(x)\,dx=a
   \]
   所以
   \[
   \int_{-\infty}^{0} f(x)\,dx=\frac a2
   \]

2. 由定义
   \[
   F(-x_0)=\int_{-\infty}^{-x_0} f(t)\,dt
   \]

最终结论：
\[
\boxed{F(-x_0)=\frac a2-\int_0^{x_0}f(x)\,dx}
\]`;
    const markup = renderToStaticMarkup(<MarkdownRenderer source={source} />);

    expect(
      markup.match(/class="katex-display"/g)?.length,
    ).toBeGreaterThanOrEqual(4);
    expect(markup).toContain('class="katex-html"');
    // KaTeX keeps the original TeX in its accessibility annotation, so the
    // assertion must target visible Markdown paragraphs rather than the full
    // HTML string.
    expect(markup).not.toMatch(/<p>\\int_{-\\infty}/);
    expect(markup).not.toMatch(/annotation[^>]*>\s*所以/);
    expect(markup).not.toMatch(/annotation[^>]*>\s*2\.\s*由定义/);
  });

  it("allows safe links and rejects javascript URLs", () => {
    expect(sanitizeMarkdownHref("https://example.com/a")).toBe(
      "https://example.com/a",
    );
    expect(sanitizeMarkdownHref("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeMarkdownHref("data:text/html,unsafe")).toBeUndefined();
    expect(sanitizeMarkdownHref("citation:doc-1:3")).toBe("citation:doc-1:3");
  });

  it("injects and renders interactive citation tags when sources are provided", () => {
    const sources = [
      {
        documentId: "doc-math-1",
        documentTitle: "高等数学复习全书.pdf",
        pageNumber: 42,
        citationLabel: "[资料1]",
      },
      {
        documentId: "doc-linear-2",
        documentTitle: "线性代数讲义.pdf",
        pageNumber: 15,
        citationLabel: "[资料2]",
      },
    ];

    const source = "详见 [资料1] 第 42 页和 [资料2] 第 15 页。";
    const markup = renderToStaticMarkup(
      <MarkdownRenderer source={source} sources={sources} />,
    );

    expect(markup).toContain('class="markdown-citation-tag"');
    expect(markup).toContain("menu_book");
    expect(markup).toContain("[资料1]");
    expect(markup).toContain("[资料2]");
  });

  it("renders kystudy-paper fenced blocks as interactive paper proposal cards", () => {
    const mockQuestions = [
      {
        id: "q-1",
        documentId: "doc-1",
        documentTitle: "高等数学.pdf",
        subjectId: "sub-1",
        subjectName: "高等数学",
        workbookId: "wb-1",
        workbookName: "考研高数 660 题",
        segmentId: "seg-1",
        chapter: "第一章 极限",
        sectionPart: "basic" as const,
        questionType: "choice" as const,
        questionNumber: "1",
        title: "极限保号性",
        indexConfidence: 1,
        sortOrder: 1,
        attemptCount: 0,
        incorrectCount: 0,
        partialCount: 0,
        regions: [],
      },
    ];

    const source = [
      "这是为你定制的套卷：",
      "",
      "```kystudy-paper",
      JSON.stringify({
        title: "高数第一章自测卷",
        description: "包含极限核心考点",
        questionIds: ["q-1"],
      }),
      "```",
    ].join("\n");

    const markup = renderToStaticMarkup(
      <MarkdownRenderer
        source={source}
        questionBankQuestions={mockQuestions}
      />,
    );

    expect(markup).toContain('class="ai-paper-proposal-card"');
    expect(markup).toContain("AI 推荐套卷");
    expect(markup).toContain("高数第一章自测卷");
    expect(markup).toContain("包含极限核心考点");
    expect(markup).toContain("共 1 道题目");
    expect(markup).toContain("立即开始模考练习");
  });

  it("converts copied content to plain text", () => {
    expect(
      markdownToPlainText(
        "**结论**\n\n[打开](https://example.com)\n\n" +
          String.fromCharCode(96) +
          "x" +
          String.fromCharCode(96) +
          "\n\n$x^2$",
      ),
    ).toBe("结论\n\n打开\n\nx\n\nx^2");
  });
});
