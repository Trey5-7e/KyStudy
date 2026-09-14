import { describe, expect, it } from "vitest";
import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import {
  calculateForgettingMeta,
  createBatchAttempts,
  diffCalendarDays,
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

  it("filters by error frequency threshold correctly", () => {
    const questions = [q1, q2, q3, q4];

    // q1: 3, q2: 1+2=3, q3: 2, q4: 1
    const gte2 = filterMistakeNotebook(questions, {
      status: "all",
      query: "",
      errorThreshold: "gte2",
    });
    expect(gte2.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);

    const gte3 = filterMistakeNotebook(questions, {
      status: "all",
      query: "",
      errorThreshold: "gte3",
    });
    expect(gte3.map((q) => q.id)).toEqual(["q1", "q2"]);
  });

  it("sorts by frequency and natural order correctly", () => {
    const questions = [q1, q2, q3, q4];

    // frequency: q1 (3 mistakes), q3 (2 mistakes), q2 (1 mistake, 2 partial), q4 (1 mistake, 0 partial)
    const byFrequency = filterMistakeNotebook(questions, {
      status: "all",
      query: "",
      sortBy: "frequency",
    });
    expect(byFrequency.map((q) => q.id)).toEqual(["q1", "q3", "q2", "q4"]);

    // natural: by sortOrder 1, 2, 3, 4
    const byNatural = filterMistakeNotebook(questions, {
      status: "all",
      query: "",
      sortBy: "natural",
    });
    expect(byNatural.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4"]);
  });

  it("creates batch attempts mapping accurately", () => {
    const attempts = createBatchAttempts(["q1", "q2", "q3"], "correct");
    expect(attempts).toEqual([
      { questionId: "q1", result: "correct" },
      { questionId: "q2", result: "correct" },
      { questionId: "q3", result: "correct" },
    ]);

    const setAttempts = createBatchAttempts(new Set(["q4"]), "incorrect");
    expect(setAttempts).toEqual([{ questionId: "q4", result: "incorrect" }]);
  });

  it("calculates calendar days difference accurately", () => {
    expect(diffCalendarDays("2026-09-14", "2026-09-14")).toBe(0);
    expect(diffCalendarDays("2026-09-16", "2026-09-14")).toBe(2);
    expect(diffCalendarDays("2026-09-10", "2026-09-14")).toBe(-4);
  });

  it("evaluates forgetting curve metadata correctly across states", () => {
    const todayStr = "2026-09-14";
    const nowMs = 1726315200000; // 2026-09-14 12:00:00

    // 1. Pending mistake, overdue by 2 days
    const qOverduePending = createMockQuestion({
      id: "q-od-pen",
      dueDate: "2026-09-12",
      currentResult: "incorrect",
      incorrectCount: 2,
    });
    const meta1 = calculateForgettingMeta(qOverduePending, todayStr, nowMs);
    expect(meta1.status).toBe("overdue");
    expect(meta1.label).toBe("已超期 2 天");
    expect(meta1.tone).toBe("danger");
    expect(meta1.urgencyScore).toBeGreaterThan(10000);

    // 2. Mastered mistake, overdue by 3 days
    const qOverdueMastered = createMockQuestion({
      id: "q-od-mas",
      dueDate: "2026-09-11",
      currentResult: "correct",
      incorrectCount: 1,
    });
    const meta2 = calculateForgettingMeta(qOverdueMastered, todayStr, nowMs);
    expect(meta2.status).toBe("overdue");
    expect(meta2.label).toBe("已超期 3 天");
    expect(meta2.tone).toBe("danger");

    // 3. Due today
    const qDueToday = createMockQuestion({
      id: "q-today",
      dueDate: "2026-09-14",
      currentResult: "incorrect",
    });
    const meta3 = calculateForgettingMeta(qDueToday, todayStr, nowMs);
    expect(meta3.status).toBe("due_today");
    expect(meta3.label).toBe("今日当复");
    expect(meta3.tone).toBe("warning");

    // 4. Pending without dueDate, last attempted 2 days ago (>24h)
    const qNoDueUrgent = createMockQuestion({
      id: "q-urgent",
      dueDate: undefined,
      currentResult: "incorrect",
      lastAttemptAt: nowMs - 48 * 3600 * 1000,
    });
    const meta4 = calculateForgettingMeta(qNoDueUrgent, todayStr, nowMs);
    expect(meta4.status).toBe("urgent_retry");
    expect(meta4.label).toBe("亟待攻克");
    expect(meta4.tone).toBe("danger");

    // 5. Due in 1 day (tomorrow)
    const qTomorrow = createMockQuestion({
      id: "q-tomorrow",
      dueDate: "2026-09-15",
      currentResult: "correct",
    });
    const meta5 = calculateForgettingMeta(qTomorrow, todayStr, nowMs);
    expect(meta5.status).toBe("expiring");
    expect(meta5.label).toBe("明日当复");
    expect(meta5.tone).toBe("info");

    // 6. Stable (due in 5 days)
    const qStable = createMockQuestion({
      id: "q-stable",
      dueDate: "2026-09-19",
      currentResult: "correct",
    });
    const meta6 = calculateForgettingMeta(qStable, todayStr, nowMs);
    expect(meta6.status).toBe("stable");
    expect(meta6.label).toBe("5 天后复习");
    expect(meta6.tone).toBe("success");
  });

  it("sorts by forgetting curve prioritizing urgency", () => {
    const todayStr = "2026-09-14";
    const nowMs = 1726315200000;

    const qOverdue = createMockQuestion({
      id: "q-overdue",
      dueDate: "2026-09-11", // overdue by 3 days
      currentResult: "incorrect",
      incorrectCount: 3,
    });
    const qToday = createMockQuestion({
      id: "q-today",
      dueDate: "2026-09-14", // due today
      currentResult: "incorrect",
      incorrectCount: 2,
    });
    const qUrgent = createMockQuestion({
      id: "q-urgent",
      dueDate: undefined,
      currentResult: "incorrect",
      lastAttemptAt: nowMs - 36 * 3600 * 1000, // > 24h
      incorrectCount: 1,
    });
    const qStable = createMockQuestion({
      id: "q-stable",
      dueDate: "2026-09-20", // due in 6 days
      currentResult: "correct",
      incorrectCount: 1,
    });

    const sorted = filterMistakeNotebook(
      [qStable, qToday, qUrgent, qOverdue],
      {
        status: "all",
        query: "",
        sortBy: "forgetting_curve",
      },
      undefined,
      todayStr,
      nowMs,
    );

    // Expected order: qOverdue -> qToday -> qUrgent -> qStable
    expect(sorted.map((q) => q.id)).toEqual([
      "q-overdue",
      "q-today",
      "q-urgent",
      "q-stable",
    ]);
  });

  it("filters questions by custom and preset tags", () => {
    const questions = [q1, q2, q3, q4];
    const tagsMap: Record<string, string[]> = {
      q1: ["计算失误", "典型好题"],
      q2: ["概念模糊"],
      q3: ["典型好题", "反常积分"],
    };

    const calcMistakes = filterMistakeNotebook(
      questions,
      {
        status: "all",
        query: "",
        tag: "计算失误",
      },
      tagsMap,
    );
    expect(calcMistakes.map((q) => q.id)).toEqual(["q1"]);

    const classicMistakes = filterMistakeNotebook(
      questions,
      {
        status: "all",
        query: "",
        tag: "典型好题",
      },
      tagsMap,
    );
    expect(classicMistakes.map((q) => q.id)).toEqual(["q1", "q3"]);

    const customTagMistakes = filterMistakeNotebook(
      questions,
      {
        status: "all",
        query: "",
        tag: "反常积分",
      },
      tagsMap,
    );
    expect(customTagMistakes.map((q) => q.id)).toEqual(["q3"]);

    const nonExistentTag = filterMistakeNotebook(
      questions,
      {
        status: "all",
        query: "",
        tag: "未打标标签",
      },
      tagsMap,
    );
    expect(nonExistentTag).toHaveLength(0);
  });
});
