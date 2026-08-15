import { describe, expect, it } from "vitest";

import type {
  IndexedQuestion,
  QuestionBankSnapshot,
} from "../../shared/tauri/questionBankClient";
import type { RelativeQuestionInsert } from "./QuestionIndexDialogs";
import { manualIndexDialogInitialSegmentId } from "./manualIndexDialogModel";

const snapshot = (segmentIds: string[]): QuestionBankSnapshot => ({
  workbooks: [],
  questions: [],
  segments: segmentIds.map((id) => ({
    id,
    documentId: `document-${id}`,
    documentTitle: "Document",
    subjectId: "subject",
    subjectName: "Subject",
    workbookId: "workbook",
    workbookName: "Workbook",
    sourceHeading: "Chapter",
    pageStart: 1,
    pageEnd: 1,
    indexState: "ready",
    questionCount: 0,
    createdAt: 0,
    updatedAt: 0,
  })),
});

const question = (segmentId: string): IndexedQuestion =>
  ({ segmentId }) as IndexedQuestion;

describe("manual index dialog segment selection", () => {
  it("prefers existing and relative-insert context over requested or first segment", () => {
    const insert = {
      anchorQuestion: question("anchor-segment"),
      placement: "before",
    } satisfies RelativeQuestionInsert;

    expect(
      manualIndexDialogInitialSegmentId(
        snapshot(["first-segment"]),
        "requested-segment",
        question("existing-segment"),
        insert,
      ),
    ).toBe("existing-segment");
    expect(
      manualIndexDialogInitialSegmentId(
        snapshot(["first-segment"]),
        "requested-segment",
        undefined,
        insert,
      ),
    ).toBe("anchor-segment");
  });

  it("falls back to requested, first available, then empty segment", () => {
    expect(
      manualIndexDialogInitialSegmentId(snapshot(["first"]), "requested"),
    ).toBe("requested");
    expect(manualIndexDialogInitialSegmentId(snapshot(["first"]))).toBe(
      "first",
    );
    expect(manualIndexDialogInitialSegmentId(snapshot([]))).toBe("");
  });
});
