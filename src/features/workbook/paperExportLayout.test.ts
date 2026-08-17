import { describe, expect, it } from "vitest";

import { layoutPaper, paperSectionHeadingText } from "./paperExportLayout";
import type { PaperExportSnapshot } from "./paperExportModel";

function snapshot(
  questionCount: number,
  solutionLines = 8,
): PaperExportSnapshot {
  return {
    id: "fixture",
    createdAt: 1,
    settings: {
      title: "练习卷",
      studentName: "",
      className: "",
      date: "2026-08-17",
      solutionLines,
      otherLines: 0,
      answerStyle: "lines",
    },
    questions: Array.from({ length: questionCount }, (_, index) => ({
      id: `q-${index}`,
      questionNumber: String(index + 1),
      questionType: "solution" as const,
      title: `题目 ${index + 1}`,
      regions: [
        {
          id: `image-${index}`,
          pageNumber: 1,
          sortOrder: 1,
          width: 500,
          height: 180,
          imageId: `image-${index}`,
        },
      ],
    })),
  };
}

describe("paper export layout", () => {
  it("keeps answer lines as independent layout elements and paginates", () => {
    const fixture = snapshot(6, 8);
    fixture.questions[0]!.regions[0]!.height = 500;
    const layout = layoutPaper(fixture);
    expect(layout.pageCount).toBeGreaterThan(1);
    const lines = layout.pages.flatMap((page) =>
      page.elements.filter((element) => element.kind === "line"),
    );
    expect(lines.length).toBe(6 * 8);
    expect(
      layout.pages
        .flatMap((page) => page.elements)
        .some((element) => element.kind === "text"),
    ).toBe(false);
  });

  it("adds one image heading for each question type", () => {
    const fixture = snapshot(3, 0);
    fixture.questions[0]!.questionType = "choice";
    fixture.questions[1]!.questionType = "blank";
    fixture.questions[2]!.questionType = "solution";
    const layout = layoutPaper(fixture);
    const headings = layout.pages
      .flatMap((page) => page.elements)
      .filter((element) => element.kind === "image")
      .filter((element) => element.imageId.startsWith("paper-section-heading-"))
      .slice(0, 3)
      .map((element) => element.imageId);
    expect(headings).toEqual([
      "paper-section-heading-choice",
      "paper-section-heading-blank",
      "paper-section-heading-solution",
    ]);
    expect(paperSectionHeadingText("choice")).toBe("一、选择题");
    expect(paperSectionHeadingText("blank")).toBe("二、填空题");
    expect(paperSectionHeadingText("solution")).toBe("三、解答题");
  });

  it("reserves blank answer space without drawing ruling lines", () => {
    const fixture = snapshot(1, 8);
    fixture.settings.answerStyle = "blank";
    const layout = layoutPaper(fixture);
    expect(
      layout.pages
        .flatMap((page) => page.elements)
        .filter((element) => element.kind === "line"),
    ).toHaveLength(0);
  });

  it("supports optional answer space for other question types", () => {
    const fixture = snapshot(1, 0);
    fixture.questions[0]!.questionType = "other";
    fixture.settings.otherLines = 4;

    const layout = layoutPaper(fixture);
    expect(
      layout.pages
        .flatMap((page) => page.elements)
        .filter((element) => element.kind === "line"),
    ).toHaveLength(4);
    expect(paperSectionHeadingText("other")).toBe("四、其他题型");
  });

  it("does not split a region in the middle of a page", () => {
    expect(() =>
      layoutPaper({
        ...snapshot(1),
        questions: [
          {
            ...snapshot(1).questions[0]!,
            regions: [
              {
                ...snapshot(1).questions[0]!.regions[0]!,
                width: 500,
                height: 20_000,
              },
            ],
          },
        ],
      }),
    ).toThrow("PAPER_EXPORT_IMAGE_TOO_TALL");
  });
});
