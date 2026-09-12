import { describe, expect, it } from "vitest";
import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import {
  filterMistakeNotebook,
  isMistakeMastered,
  isMistakePending,
  summarizeMistakes,
  type MistakeNotebookFilter,
} from "./mistakeNotebookModel";

function createMockQuestion(
  overrides: Partial<IndexedQuestion> = {},
): IndexedQuestion {
  return {
    id: "q1",
    documentId: "doc-1",
    documentTitle: "高等数学1000题",
    subjectId: "sub-math",
    subjectName: "高等数学",
    workbookId: "wb-math",
    workbookName: "高等数学1000题",
    segmentId: "seg-1",
    chapter: "第一章 极限",
    sectionPart: "basic",
    questionType: "choice",
    questionNumber: "1",
    title: "极限计算题",
    indexConfidence: 1,
    sortOrder: 1,
    attemptCount: 1,
    incorrectCount: 1,
    partialCount: 0,
    currentResult: "incorrect",
    regions: [],
    ...overrides,
  };
}

describe("mistakeNotebookModel", () => {
  const q1 = createMockQuestion({
    id: "q1",
    questionNumber: "1",
    sortOrder: 1,
    currentResult: "incorrect",
    incorrectCount: 3,
    title: "求极限的保号性",
  });
  const q2 = createMockQuestion({
    id: "q2",
    questionNumber: "2",
    sortOrder: 2,
    currentResult: "uncertain",
    incorrectCount: 1,
    partialCount: 2,
    title: "无穷小量阶的比较",
  });
  const q3 = createMockQuestion({
    id: "q3",
    questionNumber: "3",
    sortOrder: 3,
    currentResult: "correct",
    incorrectCount: 2,
    title: "导数定义的综合应用",
  });
  const q4 = createMockQuestion({
    id: "q4",
    questionNumber: "4",
    sortOrder: 4,
    subjectId: "sub-politics",
    currentResult: "incorrect",
    incorrectCount: 1,
    title: "唯物辩证法三大规律",
  });
  const cleanQuestion = createMockQuestion({
    id: "q-clean",
    questionNumber: "5",
    sortOrder: 5,
    currentResult: "correct",
    incorrectCount: 0,
    partialCount: 0,
    title: "从未做错的题目",
  });

  it("identifies pending vs mastered mistakes correctly", () => {
    expect(isMistakePending(q1)).toBe(true);
    expect(isMistakePending(q2)).toBe(true);
    expect(isMistakePending(q3)).toBe(false);

    expect(isMistakeMastered(q1)).toBe(false);
    expect(isMistakeMastered(q2)).toBe(false);
    expect(isMistakeMastered(q3)).toBe(true);
    expect(isMistakeMastered(cleanQuestion)).toBe(false);
  });

  it("summarizes mistake pool accurately", () => {
    const summary = summarizeMistakes([q1, q2, q3, q4, cleanQuestion]);
    expect(summary.totalCount).toBe(4); // cleanQuestion excluded
    expect(summary.pendingCount).toBe(3); // q1, q2, q4
    expect(summary.masteredCount).toBe(1); // q3
    expect(summary.masteryRate).toBe(25); // 1 / 4 = 25%
  });

  it("filters by status correctly", () => {
    const questions = [q1, q2, q3, q4];
    const defaultFilter: MistakeNotebookFilter = {
      status: "all",
      query: "",
    };

    const all = filterMistakeNotebook(questions, defaultFilter);
    expect(all.map((q) => q.id)).toEqual(["q1", "q4", "q2", "q3"]);

    const pending = filterMistakeNotebook(questions, {
      ...defaultFilter,
      status: "pending",
    });
    expect(pending.map((q) => q.id)).toEqual(["q1", "q4", "q2"]);

    const mastered = filterMistakeNotebook(questions, {
      ...defaultFilter,
      status: "mastered",
    });
    expect(mastered.map((q) => q.id)).toEqual(["q3"]);
  });

  it("filters by subject and query correctly", () => {
    const questions = [q1, q2, q3, q4];

    const mathOnly = filterMistakeNotebook(questions, {
      subjectId: "sub-math",
      status: "all",
      query: "",
    });
    expect(mathOnly.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);

    const querySearch = filterMistakeNotebook(questions, {
      status: "all",
      query: "无穷小",
    });
    expect(querySearch.map((q) => q.id)).toEqual(["q2"]);

    const numberSearch = filterMistakeNotebook(questions, {
      status: "all",
      query: "4",
    });
    expect(numberSearch.map((q) => q.id)).toEqual(["q4"]);
  });
});
