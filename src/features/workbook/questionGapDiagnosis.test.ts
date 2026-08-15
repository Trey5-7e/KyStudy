import { describe, expect, it } from "vitest";

import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import { diagnoseQuestionGaps } from "./questionGapDiagnosis";

describe("question gap diagnosis", () => {
  it("finds missing numbers inside one chapter part and question type", () => {
    const issues = diagnoseQuestionGaps([
      question("q1", 1, "1"),
      question("q2", 2, "2"),
      question("q4", 3, "4"),
    ]);

    expect(issues).toEqual([
      expect.objectContaining({
        kind: "missing",
        suggestedQuestionNumber: "3",
        anchorQuestionId: "q4",
        placement: "before",
        confidence: "high",
      }),
    ]);
  });

  it("does not compare independent numbering ranges across question types", () => {
    const issues = diagnoseQuestionGaps([
      question("choice-1", 1, "1"),
      question("choice-2", 2, "2"),
      question("blank-1", 3, "1", "blank"),
      question("blank-2", 4, "2", "blank"),
    ]);

    expect(issues).toEqual([]);
  });

  it("checks a shared global run when question types are interleaved", () => {
    const issues = diagnoseQuestionGaps([
      question("choice-1", 1, "1"),
      question("blank-2", 2, "2", "blank"),
      question("solution-4", 3, "4", "solution"),
    ]);

    expect(issues).toEqual([
      expect.objectContaining({
        kind: "missing",
        suggestedQuestionNumber: "3",
        anchorQuestionId: "solution-4",
      }),
    ]);
  });

  it("does not treat legal per-type interleaving as duplicate numbers", () => {
    const issues = diagnoseQuestionGaps([
      question("choice-1", 1, "1"),
      question("blank-1", 2, "1", "blank"),
      question("solution-1", 3, "1", "solution"),
      question("choice-2", 4, "2"),
      question("blank-2", 5, "2", "blank"),
      question("solution-2", 6, "2", "solution"),
    ]);

    expect(issues).toEqual([]);
  });

  it("keeps a missing number inside a per-type interleaved run", () => {
    const issues = diagnoseQuestionGaps([
      question("choice-1", 1, "1"),
      question("blank-1", 2, "1", "blank"),
      question("choice-3", 3, "3"),
      question("blank-2", 4, "2", "blank"),
    ]);

    expect(issues).toEqual([
      expect.objectContaining({
        kind: "missing",
        suggestedQuestionNumber: "2",
        anchorQuestionId: "choice-3",
      }),
    ]);
  });

  it("treats a downward number as a subsection reset", () => {
    const issues = diagnoseQuestionGaps([
      question("group-a-1", 1, "1"),
      question("group-a-2", 2, "2"),
      question("group-b-1", 3, "1"),
      question("group-b-2", 4, "2"),
    ]);

    expect(issues).toEqual([]);
  });

  it("does not infer a leading gap from a per-type run that starts high", () => {
    const issues = diagnoseQuestionGaps([
      question("choice-10", 1, "10"),
      question("blank-1", 2, "1", "blank"),
      question("choice-11", 3, "11"),
      question("blank-2", 4, "2", "blank"),
    ]);

    expect(issues).toEqual([]);
  });

  it("does not infer a leading gap before a same-type reset", () => {
    const issues = diagnoseQuestionGaps([
      question("group-a-10", 1, "10"),
      question("group-a-11", 2, "11"),
      question("group-b-1", 3, "1"),
      question("group-b-2", 4, "2"),
    ]);

    expect(issues).toEqual([]);
  });

  it("uses unfiltered context when a type filter hides shared numbers", () => {
    const allQuestions = [
      question("choice-1", 1, "1"),
      question("blank-2", 2, "2", "blank"),
      question("choice-3", 3, "3"),
    ];

    expect(
      diagnoseQuestionGaps(
        allQuestions.filter((item) => item.questionType === "choice"),
        allQuestions,
      ),
    ).toEqual([]);
  });

  it("flags duplicate numbers for inspection instead of suggesting another card", () => {
    const issues = diagnoseQuestionGaps([
      question("q1", 1, "1"),
      question("q1-copy", 2, "1"),
    ]);

    expect(issues).toEqual([
      expect.objectContaining({
        kind: "duplicate",
        questionId: "q1-copy",
        id: "duplicate|q1|1|q1-copy|1",
      }),
    ]);
  });

  it("uses both sides of a duplicate and large jump as acknowledgement fingerprints", () => {
    const duplicate = diagnoseQuestionGaps([
      question("q1", 1, "1"),
      question("q1-copy", 2, "1"),
    ])[0];
    const jump = diagnoseQuestionGaps([
      question("q1", 1, "1"),
      question("q15", 2, "15"),
    ])[0];

    expect(duplicate?.id).toBe("duplicate|q1|1|q1-copy|1");
    expect(jump?.id).toBe("jump|q1|1|q15|15");
  });

  it("includes the encoded trimmed non-numeric number in its fingerprint", () => {
    const withWhitespace = diagnoseQuestionGaps([
      question("example", 1, "  例题 A  "),
    ])[0];
    const changedNumber = diagnoseQuestionGaps([
      question("example", 1, "例题 B"),
    ])[0];

    expect(withWhitespace?.id).toBe("non_numeric|example|例题 A");
    expect(changedNumber?.id).not.toBe(withWhitespace?.id);

    const longChineseNumber = diagnoseQuestionGaps([
      question("long", 1, "题号".repeat(100)),
    ])[0];
    expect(longChineseNumber?.id.length).toBeLessThanOrEqual(500);
  });

  it("reports non-pure numbers and keeps them out of continuity checks", () => {
    const issues = diagnoseQuestionGaps([
      question("q1", 1, "1"),
      question("example", 2, "例题"),
      question("q3", 3, "3"),
      question("q5", 4, "5"),
    ]);

    expect(issues).toEqual([
      expect.objectContaining({
        kind: "non_numeric",
        questionId: "example",
        evidence: expect.stringContaining("未参与连续性判断"),
      }),
      expect.objectContaining({
        kind: "missing",
        suggestedQuestionNumber: "4",
        anchorQuestionId: "q5",
      }),
    ]);
    expect(
      issues.some(
        (issue) =>
          issue.kind === "missing" && issue.suggestedQuestionNumber === "2",
      ),
    ).toBe(false);
  });

  it("does not infer missing leading numbers after a non-pure number", () => {
    const issues = diagnoseQuestionGaps([
      question("example", 1, "例题"),
      question("q3", 2, "3"),
      question("q4", 3, "4"),
    ]);

    expect(issues).toEqual([
      expect.objectContaining({ kind: "non_numeric", questionId: "example" }),
    ]);
  });

  it("flags a large jump instead of expanding an oversized missing range", () => {
    const issues = diagnoseQuestionGaps([
      question("q1", 1, "1"),
      question("q15", 2, "15"),
    ]);

    expect(issues).toEqual([
      expect.objectContaining({
        kind: "large_jump",
        questionId: "q15",
        evidence: expect.stringContaining("跨度较大"),
      }),
    ]);
  });

  it("keeps continuity scoped to each segment, chapter, part, and type", () => {
    const issues = diagnoseQuestionGaps([
      question("segment-a-1", 1, "1"),
      question("segment-a-3", 2, "3"),
      question("segment-b-1", 1, "1", "choice", { segmentId: "segment-b" }),
      question("segment-b-3", 2, "3", "choice", { segmentId: "segment-b" }),
      question("chapter-a-1", 1, "1", "choice", { chapter: "chapter-b" }),
      question("chapter-a-3", 2, "3", "choice", { chapter: "chapter-b" }),
      question("part-a-1", 1, "1", "choice", { sectionPart: "extended" }),
      question("part-a-3", 2, "3", "choice", { sectionPart: "extended" }),
      question("type-a-1", 1, "1", "blank"),
      question("type-a-3", 2, "3", "blank"),
    ]);

    expect(
      new Set(
        issues
          .filter((issue) => issue.kind === "missing")
          .map((issue) => issue.anchorQuestionId),
      ),
    ).toEqual(
      new Set([
        "segment-a-3",
        "segment-b-3",
        "chapter-a-3",
        "part-a-3",
        "type-a-3",
      ]),
    );
  });

  it("sorts by source order and uses id as a deterministic tie breaker", () => {
    const questions = [
      question("q2", 1, "2"),
      question("q1", 1, "1"),
      question("q3", 2, "3"),
    ];

    expect(diagnoseQuestionGaps(questions)).toEqual([]);
    expect(questions.map((item) => item.id)).toEqual(["q2", "q1", "q3"]);
  });

  it("expands a gap at the configured boundary but not beyond it", () => {
    const expanded = diagnoseQuestionGaps([
      question("q1", 1, "1"),
      question("q14", 2, "14"),
    ]);
    expect(expanded).toHaveLength(12);
    expect(expanded.at(-1)).toEqual(
      expect.objectContaining({ suggestedQuestionNumber: "13" }),
    );

    const jumped = diagnoseQuestionGaps([
      question("q1", 1, "1"),
      question("q15", 2, "15"),
    ]);
    expect(jumped).toHaveLength(1);
    expect(jumped[0]).toEqual(expect.objectContaining({ kind: "large_jump" }));
  });

  it("caps issue output while preserving deterministic insertion order", () => {
    const questions = Array.from({ length: 10 }, (_, index) => {
      const number = 1 + index * 13;
      return question(`q${number}`, index + 1, String(number));
    });

    const issues = diagnoseQuestionGaps(questions);

    expect(issues).toHaveLength(100);
    expect(issues.every((issue) => issue.kind === "missing")).toBe(true);
    expect(issues[0]).toEqual(
      expect.objectContaining({
        id: "missing|q14|2",
        suggestedQuestionNumber: "2",
      }),
    );
    expect(issues[99]).toEqual(
      expect.objectContaining({ suggestedQuestionNumber: "109" }),
    );
  });
});

function question(
  id: string,
  sortOrder: number,
  questionNumber: string,
  questionType: IndexedQuestion["questionType"] = "choice",
  overrides: Partial<
    Pick<
      IndexedQuestion,
      "segmentId" | "chapter" | "sectionPart" | "questionType"
    >
  > = {},
): IndexedQuestion {
  return {
    id,
    documentId: "document",
    documentTitle: "880",
    subjectId: "subject",
    subjectName: "高等数学",
    workbookId: "workbook",
    workbookName: "880",
    segmentId: "segment",
    chapter: "第一章 函数、极限、连续",
    sectionPart: "basic",
    questionType,
    questionNumber,
    title: `第 ${questionNumber} 题`,
    indexConfidence: 1,
    sortOrder,
    attemptCount: 0,
    incorrectCount: 0,
    partialCount: 0,
    regions: [],
    ...overrides,
  };
}
