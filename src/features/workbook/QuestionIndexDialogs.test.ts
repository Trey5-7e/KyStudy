import { describe, expect, it, vi } from "vitest";

vi.mock("../review/QuestionRegionCard", () => ({
  QuestionRegionCard: vi.fn(),
}));

import {
  QUESTION_BROWSER_EDITING_NAVIGATION_STATUS,
  completeScope,
  getQuestionPreviewTags,
  questionBrowserNavigationDisabled,
  questionBrowserNavigationIndex,
} from "./QuestionIndexDialogs";
import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";

describe("question index browser edit navigation", () => {
  it("locks navigation while local edits are open", () => {
    expect(questionBrowserNavigationDisabled(true)).toBe(true);
    expect(questionBrowserNavigationDisabled(false)).toBe(false);
  });

  it("provides a concise visible recovery instruction", () => {
    expect(QUESTION_BROWSER_EDITING_NAVIGATION_STATUS).toBe("先保存或取消编辑");
  });

  it("moves one question at a time with the horizontal arrow keys", () => {
    expect(questionBrowserNavigationIndex(1, "ArrowLeft", 4)).toBe(0);
    expect(questionBrowserNavigationIndex(1, "ArrowRight", 4)).toBe(2);
    expect(questionBrowserNavigationIndex(0, "ArrowLeft", 4)).toBeUndefined();
    expect(questionBrowserNavigationIndex(3, "ArrowRight", 4)).toBeUndefined();
    expect(questionBrowserNavigationIndex(1, "ArrowUp", 4)).toBeUndefined();
  });
});

describe("completeScope", () => {
  const sampleQuestions = [
    {
      id: "q-1",
      subjectId: "math",
      workbookId: "wb-900",
      chapter: "第一章",
      sectionPart: "basic",
      questionType: "choice",
    } as unknown as IndexedQuestion,
  ];

  it("fills in sectionPart and questionType when requirePartsAndTypes is true", () => {
    const scope = completeScope(sampleQuestions, {
      subjectId: "math",
      workbookId: "wb-900",
      chapter: "第一章",
    });
    expect(scope.sectionPart).toBe("basic");
    expect(scope.questionType).toBe("choice");
  });

  it("preserves undefined sectionPart and questionType when requirePartsAndTypes is false", () => {
    const scope = completeScope(
      sampleQuestions,
      {
        subjectId: "math",
        workbookId: "wb-900",
        chapter: "第一章",
      },
      { requirePartsAndTypes: false },
    );
    expect(scope.subjectId).toBe("math");
    expect(scope.workbookId).toBe("wb-900");
    expect(scope.chapter).toBe("第一章");
    expect(scope.sectionPart).toBeUndefined();
    expect(scope.questionType).toBeUndefined();
  });
});

describe("getQuestionPreviewTags", () => {
  it("returns an empty array when questionId is undefined", () => {
    expect(getQuestionPreviewTags(undefined, { "q-1": ["必做"] })).toEqual([]);
  });

  it("returns tags for the specified questionId", () => {
    const tagsMap = {
      "q-1": ["必做", "经典好题"],
      "q-2": ["选做"],
    };
    expect(getQuestionPreviewTags("q-1", tagsMap)).toEqual([
      "必做",
      "经典好题",
    ]);
    expect(getQuestionPreviewTags("q-2", tagsMap)).toEqual(["选做"]);
  });

  it("returns an empty array when the question has no tags in the map", () => {
    const tagsMap = { "q-1": ["必做"] };
    expect(getQuestionPreviewTags("q-3", tagsMap)).toEqual([]);
  });

  it("sanitizes conflicting tags and never returns both 必做 and 选做", () => {
    const tagsMap = {
      "q-1": ["选做", "必做"],
      "q-2": ["必做", "选做"],
    };
    expect(getQuestionPreviewTags("q-1", tagsMap)).toEqual(["必做"]);
    expect(getQuestionPreviewTags("q-2", tagsMap)).toEqual(["选做"]);
  });
});
