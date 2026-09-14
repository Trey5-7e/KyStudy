import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuestionMistakeTagEditor } from "./QuestionMistakeTagEditor";
import { PRESET_MISTAKE_TAGS } from "./mistakeTagModel";

describe("QuestionMistakeTagEditor static markup", () => {
  it("renders all preset tags and reflects active states", () => {
    const markup = renderToStaticMarkup(
      <QuestionMistakeTagEditor
        questionId="q1"
        tags={["计算失误", "反常积分"]}
      />,
    );

    // Preset tag "计算失误" is selected
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("计算失误");

    // All preset tags are present
    for (const preset of PRESET_MISTAKE_TAGS) {
      expect(markup).toContain(preset.label);
    }

    // Custom tag "反常积分" is rendered
    expect(markup).toContain("反常积分");
    expect(markup).toContain("is-custom");
  });

  it("renders custom tag input form and controls", () => {
    const markup = renderToStaticMarkup(
      <QuestionMistakeTagEditor questionId="q1" tags={[]} />,
    );

    expect(markup).toContain("错题归因与考点标签");
    expect(markup).toContain("自定义考点");
    expect(markup).toContain("添加");
  });

  it("handles disabled state gracefully", () => {
    const markup = renderToStaticMarkup(
      <QuestionMistakeTagEditor
        questionId="q1"
        tags={["计算失误", "自定义考点"]}
        disabled={true}
      />,
    );

    expect(markup).toContain('disabled=""');
    // Remove button for custom tag should not be rendered when disabled
    expect(markup).not.toContain("tag-remove-btn");
  });
});
