import { describe, expect, it } from "vitest";

import type {
  IndexedQuestion,
  QuestionBankSnapshot,
  WorkbookDocumentSegment,
} from "../../shared/tauri/questionBankClient";
import { groupQuestionBankSnapshot } from "./questionBankHomeModel";

function segment(
  overrides: Partial<WorkbookDocumentSegment> = {},
): WorkbookDocumentSegment {
  return {
    id: "segment-1",
    documentId: "document-1",
    documentTitle: "习题册.pdf",
    subjectId: "math",
    subjectName: "高等数学",
    workbookId: "workbook-1",
    workbookName: "880题",
    sourceHeading: "第一章",
    pageStart: 1,
    pageEnd: 10,
    indexState: "ready",
    questionCount: 2,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function question(
  id: string,
  overrides: Partial<IndexedQuestion> = {},
): IndexedQuestion {
  return {
    id,
    documentId: "document-1",
    documentTitle: "习题册.pdf",
    subjectId: "math",
    subjectName: "高等数学",
    workbookId: "workbook-1",
    workbookName: "880题",
    segmentId: "segment-1",
    chapter: "第一章",
    sectionPart: "basic",
    questionType: "choice",
    questionNumber: id,
    title: `第 ${id} 题`,
    indexConfidence: 1,
    sortOrder: Number(id),
    attemptCount: 0,
    incorrectCount: 0,
    partialCount: 0,
    regions: [],
    ...overrides,
  };
}

describe("question bank home grouping", () => {
  it("preserves active subject/workbook order and assigns questions once", () => {
    const snapshot: QuestionBankSnapshot = {
      workbooks: [],
      segments: [
        segment({ id: "math-1" }),
        segment({
          id: "math-2",
          workbookId: "workbook-2",
          workbookName: "1000题",
        }),
        segment({
          id: "linear-1",
          subjectId: "linear",
          subjectName: "线性代数",
          workbookId: "linear-workbook",
          workbookName: "线代讲义",
        }),
      ],
      questions: [
        question("1", { segmentId: "math-1" }),
        question("2", {
          id: "2",
          segmentId: "math-2",
          workbookId: "workbook-2",
          workbookName: "1000题",
        }),
        question("3", {
          id: "3",
          subjectId: "linear",
          subjectName: "线性代数",
          segmentId: "linear-1",
          workbookId: "linear-workbook",
          workbookName: "线代讲义",
        }),
      ],
    };

    const groups = groupQuestionBankSnapshot(snapshot);

    expect(groups.map((group) => group.subjectId)).toEqual(["math", "linear"]);
    expect(groups[0]?.workbooks.map((group) => group.workbookId)).toEqual([
      "workbook-1",
      "workbook-2",
    ]);
    expect(groups[0]?.questions.map((item) => item.id)).toEqual(["1", "2"]);
    expect(groups[0]?.workbooks[1]?.questions.map((item) => item.id)).toEqual([
      "2",
    ]);
  });

  it("does not create orphan rows for questions without active segments", () => {
    const snapshot: QuestionBankSnapshot = {
      workbooks: [],
      segments: [segment()],
      questions: [
        question("1"),
        question("2", {
          id: "2",
          subjectId: "math",
          subjectName: "高等数学",
          workbookId: "workbook-1",
          segmentId: "missing-segment",
        }),
      ],
    };

    const groups = groupQuestionBankSnapshot(snapshot);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.questions.map((item) => item.id)).toEqual(["1"]);
  });
});
