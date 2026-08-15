import { describe, expect, it } from "vitest";

import {
  questionBankToolsOrientation,
  questionBankToolsSectionIndexAfterKey,
} from "./QuestionBankToolsDialog";

describe("question bank tools section keyboard navigation", () => {
  it("wraps arrows across the section list", () => {
    expect(questionBankToolsSectionIndexAfterKey(0, "ArrowLeft", 4)).toBe(3);
    expect(questionBankToolsSectionIndexAfterKey(3, "ArrowRight", 4)).toBe(0);
    expect(questionBankToolsSectionIndexAfterKey(1, "ArrowDown", 4)).toBe(2);
    expect(questionBankToolsSectionIndexAfterKey(2, "ArrowUp", 4)).toBe(1);
  });

  it("supports Home and End without wrapping", () => {
    expect(questionBankToolsSectionIndexAfterKey(2, "Home", 4)).toBe(0);
    expect(questionBankToolsSectionIndexAfterKey(0, "End", 4)).toBe(3);
  });

  it("ignores unrelated keys and empty section lists", () => {
    expect(
      questionBankToolsSectionIndexAfterKey(1, "Enter", 4),
    ).toBeUndefined();
    expect(
      questionBankToolsSectionIndexAfterKey(0, "ArrowRight", 0),
    ).toBeUndefined();
  });

  it("matches narrow horizontal and wide vertical layouts", () => {
    expect(questionBankToolsOrientation(true)).toBe("horizontal");
    expect(questionBankToolsOrientation(false)).toBe("vertical");
  });
});
