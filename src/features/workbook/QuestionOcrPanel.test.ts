import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";

import {
  MarkdownRenderer,
  normalizeMathDelimiters,
} from "../../shared/components/MarkdownRenderer";
import { ocrTextToPreviewMarkdown } from "./QuestionOcrPanel";

describe("ocrTextToPreviewMarkdown", () => {
  it("wraps OCR LaTeX segments for readable formula rendering", () => {
    const source = String.raw`1 设\lim_{x\to0}\left(1+x+\frac{f(x)}{x}\right)^{\frac{1}{x}}=\mathrm{e}^3，则\lim_{x\to0}\left(1+\frac{f(x)}{x}\right)^{\frac{1}{x}}=_____`;
    const preview = ocrTextToPreviewMarkdown(source);

    expect(preview).toContain(String.raw`\(\lim_{x\to0}`);
    expect(preview).toContain(String.raw`\mathrm{e}^3\)`);
    expect(preview).toContain("= ______");
    expect(preview).not.toContain("=_____");

    const markup = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, {
        source: preview,
        mathOutput: "html",
      }),
    );
    expect(markup).toContain('class="katex"');
    expect(markup).toContain('class="katex-html"');
    expect(normalizeMathDelimiters(preview)).toContain("$\\lim_{x\\to0}");
  });

  it("leaves plain text and already delimited formulas unchanged", () => {
    expect(ocrTextToPreviewMarkdown("普通文本")).toBe("普通文本");
    expect(ocrTextToPreviewMarkdown("$$x^2$$")).toBe("$$x^2$$");
    expect(ocrTextToPreviewMarkdown(String.raw`\(x^2\)`)).toBe(
      String.raw`\(x^2\)`,
    );
  });
});
