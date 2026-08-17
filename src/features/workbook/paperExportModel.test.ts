import { describe, expect, it } from "vitest";

import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import {
  createPaperExportSnapshot,
  defaultPaperExportSettings,
  defaultPaperFileName,
  PaperExportValidationError,
  sanitizePaperFileName,
} from "./paperExportModel";

function question(
  id: string,
  regions = [
    { id: `${id}-region`, sortOrder: 2 },
    { id: `${id}-first`, sortOrder: 1 },
  ],
): IndexedQuestion {
  return {
    id,
    documentId: "document-1",
    documentTitle: "fixture.pdf",
    subjectId: "subject-1",
    subjectName: "数学",
    workbookId: "workbook-1",
    workbookName: "fixture",
    segmentId: "segment-1",
    chapter: "第一章",
    sectionPart: "basic",
    questionType: "solution",
    questionNumber: id,
    title: `题目 ${id}`,
    indexConfidence: 1,
    sortOrder: 1,
    attemptCount: 0,
    incorrectCount: 0,
    partialCount: 0,
    regions: regions.map((region) => ({
      id: region.id,
      questionId: id,
      documentId: "document-1",
      pageNumber: 1,
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.2,
      coordinateVersion: 1,
      sortOrder: region.sortOrder,
      createdAt: 1,
    })),
  };
}

describe("paper export model", () => {
  it("creates an immutable ordered snapshot and sorts regions by sortOrder", () => {
    const images = new Map([
      ["q-region", { width: 800, height: 200 }],
      ["q-first", { width: 800, height: 200 }],
    ]);
    const snapshot = createPaperExportSnapshot(
      [question("q")],
      defaultPaperExportSettings(new Date(2026, 7, 17)),
      images,
      100,
    );
    expect(snapshot.questions[0]?.regions.map((region) => region.id)).toEqual([
      "q-first",
      "q-region",
    ]);
    expect(snapshot.settings.solutionLines).toBe(8);
    expect(snapshot.id).toBe("paper-100-1");
  });

  it("blocks missing images instead of producing a partial paper", () => {
    expect(() =>
      createPaperExportSnapshot(
        [question("q", [{ id: "missing", sortOrder: 1 }])],
        defaultPaperExportSettings(),
        new Map(),
      ),
    ).toThrow(PaperExportValidationError);
  });

  it("sanitizes Windows file names and keeps a stable default name", () => {
    expect(sanitizePaperFileName("  数学:<>/练习卷.  ")).toBe("数学练习卷");
    expect(defaultPaperFileName("数学/练习卷", "2026-08-17")).toBe(
      "数学练习卷-20260817.pdf",
    );
  });
});
