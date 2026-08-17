import { describe, expect, it } from "vitest";

import {
  markdownToPlainText,
  renderMarkdown,
  sanitizeMarkdownHref,
} from "./MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("renders supported blocks without exposing raw HTML", () => {
    const nodes = renderMarkdown(
      "# 结论\n\n**加粗** 和 $x^2$\n\n- 一\n- 二\n\n```ts\nconst x = 1;\n```",
    );
    expect(nodes.length).toBeGreaterThan(3);
    expect(JSON.stringify(nodes)).not.toContain("<script");
  });

  it("renders tables and block formulas", () => {
    const nodes = renderMarkdown(
      "| 项目 | 值 |\n| --- | --- |\n| 结论 | $x$ |\n\n$$\nx^2\n$$",
    );
    expect(
      nodes.some(
        (node) =>
          typeof node === "object" &&
          node !== null &&
          "type" in node &&
          node.type === "table",
      ),
    ).toBe(true);
    expect(JSON.stringify(nodes)).toContain("markdown-math-block");
  });

  it("keeps raw HTML and unsafe images as text", () => {
    const nodes = renderMarkdown(
      "<script>alert(1)</script>\n\n![危险](javascript:alert(1))",
    );
    const serialized = JSON.stringify(nodes);
    expect(serialized).not.toContain('"type":"script"');
    expect(serialized).not.toContain('"type":"img"');
    expect(serialized).toContain("alert(1)");
  });

  it("falls back to the source when a formula cannot be parsed", () => {
    const nodes = renderMarkdown("$$\n{\n$$");
    const serialized = JSON.stringify(nodes);
    expect(serialized).toContain('"children":"{"');
    expect(serialized).not.toContain("katex-error");
  });

  it("allows safe links and rejects javascript URLs", () => {
    expect(sanitizeMarkdownHref("https://example.com/a")).toBe(
      "https://example.com/a",
    );
    expect(sanitizeMarkdownHref("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeMarkdownHref("data:text/html,unsafe")).toBeUndefined();
  });

  it("converts copied content to plain text", () => {
    expect(
      markdownToPlainText("**结论**\n\n[打开](https://example.com)\n\n`x`"),
    ).toBe("结论\n\n打开\n\nx");
  });
});
