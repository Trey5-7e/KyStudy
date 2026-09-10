import { describe, it, expect } from "vitest";
import {
  parseStudyPages,
  isStudyActive,
  hasPartialStudySource,
  studySourceText,
  studyQuestion,
} from "./agentStudyModel";
import type { AgentResult } from "../../shared/tauri/agentClient";
const chunk = (offset: number, endOffset: number): AgentResult => ({
  kind: "tool_result",
  call_id: `${offset}`,
  source_id: "source",
  text: JSON.stringify({
    text: "片段",
    offset,
    endOffset,
    totalCharacters: 100,
  }),
});
describe("study evidence coverage", () => {
  it("shows the current question without leaking the previous context envelope", () => {
    expect(
      studyQuestion(
        JSON.stringify({
          kind: "study_followup",
          question: "为什么",
          previousAnswer: "旧回答",
        }),
      ),
    ).toBe("为什么");
    expect(studyQuestion("普通问题")).toBe("普通问题");
  });
  it("merges contiguous chunks regardless of arrival order", () =>
    expect(
      hasPartialStudySource([chunk(50, 100), chunk(0, 50)], ["source"]),
    ).toBe(false));
  it("does not mistake the last chunk for a complete page", () =>
    expect(
      hasPartialStudySource([chunk(0, 40), chunk(50, 100)], ["source"]),
    ).toBe(true));
  it("treats old or missing receipts as partial", () =>
    expect(hasPartialStudySource([], ["source"])).toBe(true));
  it("deduplicates visible excerpts", () =>
    expect(studySourceText([chunk(0, 50), chunk(0, 50)], "source")).toBe(
      "片段",
    ));
});
describe("explicit study page selection", () => {
  it("deduplicates physical pages and accepts localized separators", () =>
    expect(parseStudyPages("3, 1-2，2", 10)).toEqual([1, 2, 3]));
  it.each(["", "0", "2-1", "1-25", "1-999999999", "foo", "1,", "1.5", "-1"])(
    "rejects invalid or implicitly unbounded range %s",
    (value) => expect(parseStudyPages(value, 100)).toEqual([]),
  );
  it("does not expand past known document pages", () =>
    expect(parseStudyPages("4-8", 6)).toEqual([]));
  it("polls only actual execution states", () => {
    expect(isStudyActive("running")).toBe(true);
    expect(isStudyActive("waiting_for_input")).toBe(false);
    expect(isStudyActive("failed")).toBe(false);
  });
});
