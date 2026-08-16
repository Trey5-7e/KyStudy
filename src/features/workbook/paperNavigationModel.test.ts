import { describe, expect, it } from "vitest";

import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import {
  filterPaperQuestions,
  navigatePaperQuestion,
  paperQuestionPosition,
  selectPaperQuestionId,
  shouldHandlePaperNavigationKey,
} from "./paperNavigationModel";

function question(
  id: string,
  questionType: IndexedQuestion["questionType"],
): IndexedQuestion {
  return {
    id,
    documentId: `doc-${id}`,
    documentTitle: "题库",
    subjectId: "subject",
    subjectName: "科目",
    workbookId: "workbook",
    workbookName: "练习册",
    segmentId: "segment",
    chapter: "章节",
    sectionPart: "basic",
    questionType,
    questionNumber: id,
    title: id,
    indexConfidence: 1,
    sortOrder: Number(id.replace(/\D/g, "")) || 0,
    attemptCount: 0,
    incorrectCount: 0,
    partialCount: 0,
    regions: [],
  };
}

const questions = [
  question("q1", "choice"),
  question("q2", "blank"),
  question("q3", "choice"),
];

describe("paper navigation model", () => {
  it("uses the first unanswered question when the active question is missing", () => {
    expect(selectPaperQuestionId(questions, "missing", { q1: "correct" })).toBe(
      "q2",
    );
  });

  it("clamps navigation at both ends without wrapping", () => {
    expect(navigatePaperQuestion(questions, "q1", "previous")).toBeUndefined();
    expect(navigatePaperQuestion(questions, "q3", "next")).toBeUndefined();
    expect(navigatePaperQuestion(questions, "q2", "next")).toBe("q3");
  });

  it("keeps full-paper and filtered positions separate", () => {
    const visible = filterPaperQuestions(questions, "choice");
    expect(paperQuestionPosition(questions, visible, "q3")).toEqual({
      filteredIndex: 1,
      filteredTotal: 2,
      paperIndex: 2,
      paperTotal: 3,
    });
  });

  it("does not handle modified or form direction-key events", () => {
    expect(
      shouldHandlePaperNavigationKey({
        key: "ArrowLeft",
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        target: null,
      }),
    ).toBe(true);
    expect(
      shouldHandlePaperNavigationKey({
        key: "ArrowRight",
        altKey: true,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        target: null,
      }),
    ).toBe(false);
  });
});
