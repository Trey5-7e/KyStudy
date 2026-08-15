import { describe, expect, it, vi } from "vitest";

vi.mock("../review/QuestionRegionCard", () => ({
  QuestionRegionCard: vi.fn(),
}));

import {
  QUESTION_BROWSER_EDITING_NAVIGATION_STATUS,
  questionBrowserNavigationDisabled,
  questionBrowserNavigationIndex,
} from "./QuestionIndexDialogs";

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
