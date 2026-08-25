import { describe, expect, it } from "vitest";

import {
  buildWorkbookPdfBaseline,
  serializeWorkbookPdfBaseline,
  workbookPdfBaselineFileName,
} from "./workbookPdfBaseline";

describe("workbook PDF baseline reports", () => {
  it("builds deterministic aggregate and per-subject diagnostics", () => {
    const subjects = [
      detectedSubject("subject-2", "profile-b", ["choice", "solution"]),
      detectedSubject("subject-1", "profile-a", ["blank"]),
    ];

    const report = buildWorkbookPdfBaseline({
      title: "做题本.pdf",
      sha256: "A".repeat(64),
      pageCount: 12,
      subjects,
    });

    expect(report).toEqual({
      schemaVersion: 1,
      source: {
        title: "做题本.pdf",
        sha256: "A".repeat(64),
        pageCount: 12,
      },
      analysis: {
        profileIds: ["profile-a", "profile-b"],
        subjectCount: 2,
        questionCount: 3,
        questionTypeCounts: {
          choice: 1,
          blank: 1,
          solution: 1,
          other: 0,
        },
        warningCount: 2,
        ocrPageCount: 2,
        unresolvedMarkerCount: 1,
        crossPageQuestionCount: 1,
      },
      subjects: [
        expect.objectContaining({
          key: "subject-2",
          questionCount: 2,
          questionTypeCounts: {
            choice: 1,
            blank: 0,
            solution: 1,
            other: 0,
          },
        }),
        expect.objectContaining({
          key: "subject-1",
          questionCount: 1,
          questionTypeCounts: {
            choice: 0,
            blank: 1,
            solution: 0,
            other: 0,
          },
        }),
      ],
    });
    expect(serializeWorkbookPdfBaseline(report)).toBe(
      `${JSON.stringify(report, null, 2)}\n`,
    );
  });

  it("falls back to the detected last page when metadata is unavailable", () => {
    const report = buildWorkbookPdfBaseline({
      title: "scan.pdf",
      sha256: "B".repeat(64),
      subjects: [detectedSubject("subject-2", "profile", ["other"])],
    });

    expect(report.source.pageCount).toBe(8);
  });

  it("creates a safe local filename without changing the report title", () => {
    expect(workbookPdfBaselineFileName("【A4】练习:本?.pdf")).toBe(
      "【A4】练习_本_-baseline.json",
    );
    expect(workbookPdfBaselineFileName("...")).toBe(
      "workbook-pdf-baseline.json",
    );
  });
});

function detectedSubject(
  key: string,
  profileId: string,
  questionTypes: readonly ("choice" | "blank" | "solution" | "other")[],
) {
  return {
    key,
    profileId,
    suggestedName: key,
    sourceHeading: `${key} heading`,
    pageStart: key === "subject-1" ? 1 : 5,
    pageEnd: key === "subject-1" ? 4 : 8,
    warningCount: 1,
    ocrPageCount: 1,
    unresolvedMarkerCount: key === "subject-1" ? 1 : 0,
    crossPageQuestionCount: key === "subject-1" ? 0 : 1,
    questions: questionTypes.map((questionType, index) => ({
      sourceKey: `${key}-${index + 1}`,
      title: `第 ${index + 1} 题`,
      chapter: "第一章",
      sectionPart: "basic" as const,
      questionType,
      questionNumber: String(index + 1),
      indexConfidence: 0.96,
      regions: [],
    })),
  };
}
