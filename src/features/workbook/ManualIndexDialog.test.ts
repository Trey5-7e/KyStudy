import { describe, expect, it } from "vitest";

import type {
  IndexedQuestion,
  QuestionBankSnapshot,
} from "../../shared/tauri/questionBankClient";
import type { RelativeQuestionInsert } from "./QuestionIndexDialogs";
import {
  manualIndexDialogInitialSegmentId,
  nextSuggestedQuestionNumber,
  nextSuggestedQuestionTitle,
} from "./manualIndexDialogModel";

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

describe("nextSuggestedQuestionNumber and title", () => {
  it("increments simple integer question numbers", () => {
    expect(nextSuggestedQuestionNumber("1")).toBe("2");
    expect(nextSuggestedQuestionNumber("9")).toBe("10");
    expect(nextSuggestedQuestionNumber("15")).toBe("16");
  });

  it("preserves leading zeros if padded", () => {
    expect(nextSuggestedQuestionNumber("01")).toBe("02");
    expect(nextSuggestedQuestionNumber("09")).toBe("10");
  });

  it("handles sub-question numbering like 1.1 or Q1", () => {
    expect(nextSuggestedQuestionNumber("1.1")).toBe("1.2");
    expect(nextSuggestedQuestionNumber("Q5")).toBe("Q6");
    expect(nextSuggestedQuestionNumber("第3题")).toBe("第4题");
  });

  it("handles empty or non-numeric strings safely", () => {
    expect(nextSuggestedQuestionNumber("")).toBe("");
    expect(nextSuggestedQuestionNumber("abc")).toBe("abc");
  });

  it("generates natural question titles", () => {
    expect(nextSuggestedQuestionTitle("2")).toBe("第 2 题");
    expect(nextSuggestedQuestionTitle("", "自定义标题")).toBe("自定义标题");
  });
});
