import { describe, expect, it } from "vitest";

import { layoutPaper, paperSectionHeadingImageId } from "./paperExportLayout";
import { createPaperPdf } from "./paperPdfWriter";
import type { PaperExportSnapshot } from "./paperExportModel";

describe("paper PDF writer", () => {
  it("writes a valid PDF envelope with page and image objects", () => {
    const snapshot: PaperExportSnapshot = {
      id: "fixture",
      createdAt: 1,
      settings: {
        title: "Fixture",
        studentName: "",
        className: "",
        date: "2026-08-17",
        solutionLines: 8,
        otherLines: 0,
        answerStyle: "lines",
      },
      questions: [
        {
          id: "q1",
          questionNumber: "1",
          questionType: "choice",
          title: "Fixture question",
          regions: [
            {
              id: "r1",
              pageNumber: 1,
              sortOrder: 1,
              width: 100,
              height: 50,
              imageId: "r1",
            },
          ],
        },
      ],
    };
    const pdf = createPaperPdf(layoutPaper(snapshot), [
      {
        id: "r1",
        width: 100,
        height: 50,
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      },
      {
        id: paperSectionHeadingImageId("choice"),
        width: 720,
        height: 96,
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      },
    ]);
    const text = new TextDecoder().decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Subtype /Image");
    expect(text).not.toContain("/Font");
    expect(text).toContain("%%EOF");
  });

  it("keeps a multi-page mixed-type fixture image-only and page-count stable", () => {
    const questionTypes = ["choice", "blank", "solution"] as const;
    const questions = Array.from({ length: 20 }, (_, index) => {
      const questionType = questionTypes[index % questionTypes.length]!;
      return {
        id: `q-${index + 1}`,
        questionNumber: String(index + 1),
        questionType,
        title: `题目 ${index + 1}`,
        regions: [
          {
            id: `region-${index + 1}`,
            pageNumber: 1,
            sortOrder: 1,
            width: 500,
            height: 220,
            imageId: `region-${index + 1}`,
          },
        ],
      };
    });
    const snapshot: PaperExportSnapshot = {
      id: "complex-fixture",
      createdAt: 1,
      settings: {
        title: "复杂布局 fixture",
        studentName: "",
        className: "",
        date: "2026-08-17",
        solutionLines: 8,
        otherLines: 0,
        answerStyle: "lines",
      },
      questions,
    };
    const layout = layoutPaper(snapshot);
    const images = [
      ...questions.map((question) => ({
        id: question.regions[0]!.imageId,
        width: 500,
        height: 220,
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      })),
      ...questionTypes.map((questionType) => ({
        id: paperSectionHeadingImageId(questionType),
        width: 720,
        height: 96,
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      })),
    ];
    const pdf = createPaperPdf(layout, images);
    const text = new TextDecoder().decode(pdf);

    expect(layout.pageCount).toBeGreaterThan(1);
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(
      layout.pageCount,
    );
    expect((text.match(/\/Subtype \/Image\b/g) ?? []).length).toBe(
      images.length,
    );
    expect(text).not.toContain("/Font");
    expect(text).toContain("%%EOF");
  });
});
