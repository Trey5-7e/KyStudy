import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BatchTagDialog } from "./BatchTagDialog";

describe("BatchTagDialog static markup", () => {
  it("renders when open and shows batch details", () => {
    const markup = renderToStaticMarkup(
      <BatchTagDialog
        isOpen={true}
        selectedQuestionsCount={5}
        allKnownTags={["计算失误", "概念模糊", "拉格朗日中值定理"]}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(markup).toContain("批量打标签 (5 道错题)");
    expect(markup).toContain("为选中题目添加标签");
    expect(markup).toContain("从选中题目移除标签");
    expect(markup).toContain("计算失误");
    expect(markup).toContain("拉格朗日中值定理");
  });

  it("does not render when closed", () => {
    const markup = renderToStaticMarkup(
      <BatchTagDialog
        isOpen={false}
        selectedQuestionsCount={3}
        allKnownTags={["计算失误"]}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    expect(markup).toBe("");
  });
});
