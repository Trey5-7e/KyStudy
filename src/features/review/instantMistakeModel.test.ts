import { describe, expect, it } from "vitest";
import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import {
  filterMistakePool,
  indexedQuestionToReviewItem,
  isMistakeQuestion,
  scoreMistakeQuestion,
  selectInstantMistakeQuestions,
} from "./instantMistakeModel";

function mockQuestion(
  id: string,
  currentResult?: IndexedQuestion["currentResult"],
  incorrectCount = 0,
  partialCount = 0,
  attemptCount = 0,
  subjectId = "math",
): IndexedQuestion {
  return {
    id,
    documentId: "doc-1",
    documentTitle: "高等数学考研真题",
    subjectId,
    subjectName: subjectId === "math" ? "高等数学" : "线性代数",
    workbookId: "wb-1",
    workbookName: "复习全书",
    segmentId: "seg-1",
    chapter: "第1章 极限与连续",
    sectionPart: "basic",
    questionType: "choice",
    questionNumber: id,
    title: `第 ${id} 题`,
    indexConfidence: 1,
    sortOrder: Number(id) || 1,
    currentResult,
    attemptCount,
    incorrectCount,
    partialCount,
    regions: [],
  };
}

describe("instantMistakeModel", () => {
  describe("isMistakeQuestion", () => {
    it("identifies currently incorrect and uncertain questions as mistakes", () => {
      expect(isMistakeQuestion(mockQuestion("1", "incorrect"))).toBe(true);
      expect(isMistakeQuestion(mockQuestion("2", "uncertain"))).toBe(true);
    });

    it("identifies historically incorrect questions as mistakes even if current result is correct", () => {
      expect(isMistakeQuestion(mockQuestion("3", "correct", 2, 0, 3))).toBe(
        true,
      );
      expect(isMistakeQuestion(mockQuestion("4", "correct", 0, 1, 2))).toBe(
        true,
      );
    });

    it("returns false for pure correct questions without historical errors", () => {
      expect(isMistakeQuestion(mockQuestion("5", "correct", 0, 0, 1))).toBe(
        false,
      );
      expect(isMistakeQuestion(mockQuestion("6", undefined, 0, 0, 0))).toBe(
        false,
      );
    });
  });

  describe("filterMistakePool", () => {
    it("filters questions to only mistakes and respects subjectId", () => {
      const questions = [
        mockQuestion("1", "incorrect", 1, 0, 1, "math"),
        mockQuestion("2", "correct", 0, 0, 1, "math"),
        mockQuestion("3", "uncertain", 0, 1, 1, "linear"),
        mockQuestion("4", "incorrect", 2, 0, 2, "linear"),
      ];

      const allMistakes = filterMistakePool(questions);
      expect(allMistakes.map((q) => q.id)).toEqual(["1", "3", "4"]);

      const mathMistakes = filterMistakePool(questions, "math");
      expect(mathMistakes.map((q) => q.id)).toEqual(["1"]);

      const linearMistakes = filterMistakePool(questions, "linear");
      expect(linearMistakes.map((q) => q.id)).toEqual(["3", "4"]);
    });
  });

  describe("scoreMistakeQuestion", () => {
    it("prioritizes currently incorrect questions over uncertain and correct questions", () => {
      const qIncorrect = mockQuestion("1", "incorrect", 1, 0, 1);
      const qUncertain = mockQuestion("2", "uncertain", 0, 1, 1);
      const qCorrectHistory = mockQuestion("3", "correct", 1, 0, 2);

      expect(scoreMistakeQuestion(qIncorrect)).toBeGreaterThan(
        scoreMistakeQuestion(qUncertain),
      );
      expect(scoreMistakeQuestion(qUncertain)).toBeGreaterThan(
        scoreMistakeQuestion(qCorrectHistory),
      );
    });

    it("scores stubborn mistakes with multiple errors higher", () => {
      const stubborn = mockQuestion("1", "incorrect", 4, 0, 5);
      const singleError = mockQuestion("2", "incorrect", 1, 0, 1);

      expect(scoreMistakeQuestion(stubborn)).toBeGreaterThan(
        scoreMistakeQuestion(singleError),
      );
    });
  });

  describe("selectInstantMistakeQuestions", () => {
    it("returns top scoring questions up to specified count", () => {
      const questions = [
        mockQuestion("1", "correct", 1, 0, 2), // lower score
        mockQuestion("2", "incorrect", 3, 0, 3), // highest score
        mockQuestion("3", "uncertain", 0, 1, 1), // medium score
        mockQuestion("4", "correct", 0, 0, 1), // not mistake
      ];

      const selected = selectInstantMistakeQuestions(questions, { count: 2 });
      expect(selected.map((q) => q.id)).toEqual(["2", "3"]);
    });

    it("handles avoidQuestionIds by pushing fresh candidates first", () => {
      const questions = [
        mockQuestion("1", "incorrect", 3, 0, 3), // highest, but in avoid
        mockQuestion("2", "incorrect", 2, 0, 2), // fresh
        mockQuestion("3", "uncertain", 1, 1, 2), // fresh
      ];

      const avoid = new Set(["1"]);
      const selected = selectInstantMistakeQuestions(questions, {
        count: 2,
        avoidQuestionIds: avoid,
      });

      expect(selected.map((q) => q.id)).toEqual(["2", "3"]);
    });

    it("falls back to avoided questions if fresh candidates are fewer than count", () => {
      const questions = [
        mockQuestion("1", "incorrect", 3, 0, 3), // avoided
        mockQuestion("2", "incorrect", 2, 0, 2), // fresh
      ];

      const avoid = new Set(["1"]);
      const selected = selectInstantMistakeQuestions(questions, {
        count: 2,
        avoidQuestionIds: avoid,
      });

      expect(selected.map((q) => q.id)).toEqual(["2", "1"]);
    });

    it("returns empty array if mistake pool is empty", () => {
      const questions = [mockQuestion("1", "correct", 0, 0, 1)];
      const selected = selectInstantMistakeQuestions(questions, { count: 5 });
      expect(selected).toEqual([]);
    });
  });

  describe("indexedQuestionToReviewItem", () => {
    it("correctly converts IndexedQuestion to ReviewSchemeQueueItem", () => {
      const q = mockQuestion("42", "incorrect", 1, 0, 1);
      const item = indexedQuestionToReviewItem(q, 0);

      expect(item.question.question.id).toBe("42");
      expect(item.question.question.title).toBe("第 42 题");
      expect(item.position).toBe(0);
      expect(item.state).toBe("pending");
    });
  });
});
