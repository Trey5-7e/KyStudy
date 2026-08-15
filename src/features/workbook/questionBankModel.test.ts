import { describe, expect, it } from "vitest";

import type {
  IndexedQuestion,
  QuestionBankSnapshot,
  SectionPart,
  TrashedWorkbookDocumentSegment,
  WorkbookCategory,
  WorkbookDocumentSegment,
} from "../../shared/tauri/questionBankClient";
import {
  countQuestionsInSegment,
  findSegmentReassignConflicts,
  findMatchingSegments,
  findSegmentRestoreConflicts,
  generateWeightedPaper,
  getSegmentReassignOptions,
  paperChapterKey,
  parseQuestionNumberSelection,
  questionSegmentVisibility,
  questionWeight,
  questionsInPaperScope,
  questionsInPaperScopeGroups,
  questionsInSegment,
  questionsInScope,
  segmentAssignmentConflict,
  segmentDeletionSummary,
  type PaperScopeGroup,
} from "./questionBankModel";

function question(
  id: string,
  type: IndexedQuestion["questionType"],
  result?: IndexedQuestion["currentResult"],
  subjectId = "math",
): IndexedQuestion {
  return {
    id,
    documentId: "d",
    documentTitle: "880",
    subjectId,
    subjectName: subjectId === "linear" ? "线性代数" : "高等数学",
    workbookId: "880",
    workbookName: "880",
    segmentId: "segment",
    chapter: "第一章",
    sectionPart: "basic",
    questionType: type,
    questionNumber: id,
    title: `第 ${id} 题`,
    indexConfidence: 0.96,
    sortOrder: Number(id),
    currentResult: result,
    attemptCount: result === undefined ? 0 : 1,
    incorrectCount: result === "incorrect" ? 1 : 0,
    partialCount: result === "uncertain" ? 1 : 0,
    regions: [],
  };
}

function segment(
  overrides: Partial<WorkbookDocumentSegment> = {},
): WorkbookDocumentSegment {
  return {
    id: "segment",
    documentId: "document",
    documentTitle: "习题册.pdf",
    subjectId: "math",
    subjectName: "高等数学",
    workbookId: "880",
    workbookName: "880",
    sourceHeading: "高等数学",
    pageStart: 3,
    pageEnd: 12,
    indexState: "ready",
    questionCount: 99,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function workbook(id: string, name = id): WorkbookCategory {
  return { id, name, createdAt: 1, updatedAt: 1 };
}

function trashedSegment(
  overrides: Partial<TrashedWorkbookDocumentSegment> = {},
): TrashedWorkbookDocumentSegment {
  return {
    ...segment({
      id: "trashed-segment",
      documentId: "document",
      pageStart: 3,
      pageEnd: 12,
      indexState: "pending",
      questionCount: 0,
      updatedAt: 20,
    }),
    deletedAt: 30,
    restorableQuestionCount: 2,
    ...overrides,
  };
}

describe("question bank model", () => {
  it("defaults to the workbook of one exact active segment", () => {
    const result = findMatchingSegments(
      [segment({ workbookId: "existing", workbookName: "已有 880" })],
      {
        documentId: "document",
        subjectId: "math",
        pageStart: 3,
        pageEnd: 12,
      },
    );

    expect(result.defaultWorkbookId).toBe("existing");
    expect(result.exact).toHaveLength(1);
  });

  it("does not guess when no exact segment exists or multiple workbooks match", () => {
    const noMatch = findMatchingSegments([segment({ pageEnd: 13 })], {
      documentId: "document",
      subjectId: "math",
      pageStart: 3,
      pageEnd: 12,
    });
    expect(noMatch.defaultWorkbookId).toBeUndefined();
    expect(noMatch.exact).toEqual([]);

    const multiple = findMatchingSegments(
      [
        segment({ id: "one", workbookId: "one" }),
        segment({ id: "two", workbookId: "two" }),
      ],
      {
        documentId: "document",
        subjectId: "math",
        pageStart: 3,
        pageEnd: 12,
      },
    );
    expect(multiple.defaultWorkbookId).toBeUndefined();
    expect(multiple.exact.map((value) => value.workbookId)).toEqual([
      "one",
      "two",
    ]);
  });

  it("does not match a same-range segment under another subject or a different range", () => {
    const result = findMatchingSegments(
      [
        segment({
          id: "other-subject",
          subjectId: "linear",
          subjectName: "线性代数",
        }),
        segment({ id: "different-range", pageStart: 4 }),
      ],
      {
        documentId: "document",
        subjectId: "math",
        pageStart: 3,
        pageEnd: 12,
      },
    );

    expect(result.exact).toEqual([]);
    expect(result.sameRangeOtherSubjects.map((value) => value.id)).toEqual([
      "other-subject",
    ]);
    expect(result.defaultWorkbookId).toBeUndefined();
  });

  it("summarizes a different-workbook conflict with live question count", () => {
    const existing = segment({
      id: "existing",
      workbookId: "old-workbook",
      workbookName: "旧练习册",
      questionCount: 99,
    });
    const snapshot: QuestionBankSnapshot = {
      workbooks: [],
      segments: [existing],
      questions: [
        question("1", "choice"),
        { ...question("2", "blank"), segmentId: "existing" },
        { ...question("3", "solution"), segmentId: "existing" },
      ],
    };

    expect(
      segmentAssignmentConflict(snapshot, {
        documentId: "document",
        subjectId: "math",
        pageStart: 3,
        pageEnd: 12,
        workbookId: "new-workbook",
      }),
    ).toEqual({
      target: {
        documentId: "document",
        subjectId: "math",
        pageStart: 3,
        pageEnd: 12,
        workbookId: "new-workbook",
      },
      existing: [
        {
          segmentId: "existing",
          documentId: "document",
          documentTitle: "习题册.pdf",
          pageStart: 3,
          pageEnd: 12,
          subjectId: "math",
          subjectName: "高等数学",
          workbookId: "old-workbook",
          workbookName: "旧练习册",
          questionCount: 2,
        },
      ],
    });
  });

  it("does not flag the selected existing workbook as a conflict", () => {
    const snapshot: QuestionBankSnapshot = {
      workbooks: [],
      segments: [segment({ workbookId: "existing" })],
      questions: [],
    };

    expect(
      segmentAssignmentConflict(snapshot, {
        documentId: "document",
        subjectId: "math",
        pageStart: 3,
        pageEnd: 12,
        workbookId: "existing",
      }),
    ).toBeUndefined();
  });

  it("reports the other exact workbooks when a range has multiple matches", () => {
    const snapshot: QuestionBankSnapshot = {
      workbooks: [],
      segments: [
        segment({
          id: "selected",
          workbookId: "selected",
          workbookName: "当前",
        }),
        segment({ id: "other", workbookId: "other", workbookName: "另一个" }),
      ],
      questions: [{ ...question("1", "choice"), segmentId: "other" }],
    };

    expect(
      segmentAssignmentConflict(snapshot, {
        documentId: "document",
        subjectId: "math",
        pageStart: 3,
        pageEnd: 12,
        workbookId: "selected",
      })?.existing,
    ).toEqual([
      expect.objectContaining({
        segmentId: "other",
        workbookId: "other",
        questionCount: 1,
      }),
    ]);
  });

  it("finds an exact active restore conflict with the existing workbook count", () => {
    const trashed = trashedSegment({
      workbookId: "target",
      workbookName: "目标练习册",
    });
    const existing = segment({
      id: "active-existing",
      workbookId: "existing",
      workbookName: "已有练习册",
    });
    const snapshot: QuestionBankSnapshot = {
      workbooks: [],
      segments: [existing],
      questions: [
        { ...question("1", "choice"), segmentId: "active-existing" },
        { ...question("2", "blank"), segmentId: "active-existing" },
      ],
    };

    expect(findSegmentRestoreConflicts(snapshot, trashed)).toEqual({
      target: trashed,
      existing: [
        expect.objectContaining({
          segmentId: "active-existing",
          workbookId: "existing",
          workbookName: "已有练习册",
          questionCount: 2,
        }),
      ],
    });
  });

  it("reports every conflicting workbook for an exact restore range", () => {
    const trashed = trashedSegment({ workbookId: "target" });
    const first = segment({
      id: "active-one",
      workbookId: "one",
      workbookName: "练习册一",
    });
    const second = segment({
      id: "active-two",
      workbookId: "two",
      workbookName: "练习册二",
    });
    const snapshot: QuestionBankSnapshot = {
      workbooks: [],
      segments: [first, second],
      questions: [
        { ...question("1", "choice"), segmentId: "active-one" },
        { ...question("2", "blank"), segmentId: "active-two" },
        { ...question("3", "solution"), segmentId: "active-two" },
      ],
    };

    expect(findSegmentRestoreConflicts(snapshot, trashed)?.existing).toEqual([
      expect.objectContaining({ segmentId: "active-one", questionCount: 1 }),
      expect.objectContaining({ segmentId: "active-two", questionCount: 2 }),
    ]);
  });

  it("does not block restore for the same workbook or another subject", () => {
    const sameWorkbook = trashedSegment({ workbookId: "same" });
    const sameWorkbookSnapshot: QuestionBankSnapshot = {
      workbooks: [],
      segments: [segment({ id: "same-active", workbookId: "same" })],
      questions: [],
    };
    expect(
      findSegmentRestoreConflicts(sameWorkbookSnapshot, sameWorkbook),
    ).toBeUndefined();

    const otherSubject = trashedSegment({ subjectId: "math" });
    const otherSubjectSnapshot: QuestionBankSnapshot = {
      workbooks: [],
      segments: [
        segment({
          id: "linear-active",
          subjectId: "linear",
          subjectName: "线性代数",
          workbookId: "other",
        }),
      ],
      questions: [],
    };
    expect(
      findSegmentRestoreConflicts(otherSubjectSnapshot, otherSubject),
    ).toBeUndefined();
  });

  it("allows reassignment to the source workbook", () => {
    const source = segment({ id: "source", workbookId: "880" });
    const assessment = findSegmentReassignConflicts(
      { segments: [source], questions: [] },
      [trashedSegment({ workbookId: "880" })],
      source,
      "880",
    );

    expect(assessment).toMatchObject({
      sourceSegmentId: "source",
      targetWorkbookId: "880",
      sameTarget: true,
      canReassign: true,
      disabledReason: undefined,
    });
  });

  it("blocks an exact active sibling in another workbook", () => {
    const source = segment({ id: "source", workbookId: "880" });
    const sibling = segment({
      id: "sibling",
      workbookId: "1000",
      workbookName: "1000题",
    });
    const assessment = findSegmentReassignConflicts(
      {
        segments: [source, sibling],
        questions: [{ ...question("1", "choice"), segmentId: "sibling" }],
      },
      [],
      source,
      "1000",
    );

    expect(assessment.disabledReason).toBe("active-sibling");
    expect(assessment.canReassign).toBe(false);
    expect(assessment.activeSiblings).toEqual([
      expect.objectContaining({ segmentId: "sibling", questionCount: 1 }),
    ]);
  });

  it("blocks a trashed exact target while retaining its restore summary", () => {
    const source = segment({ id: "source", workbookId: "880" });
    const trashed = trashedSegment({
      id: "trashed-target",
      workbookId: "1000",
      workbookName: "1000题",
      restorableQuestionCount: 649,
    });
    const assessment = findSegmentReassignConflicts(
      { segments: [source], questions: [] },
      [trashed],
      source,
      "1000",
    );

    expect(assessment.disabledReason).toBe("trashed-target");
    expect(assessment.canReassign).toBe(false);
    expect(assessment.trashedTargets).toEqual([trashed]);
  });

  it("reports every exact active sibling and ignores another subject", () => {
    const source = segment({ id: "source", workbookId: "880" });
    const first = segment({ id: "first", workbookId: "1000" });
    const second = segment({ id: "second", workbookId: "other" });
    const otherSubject = segment({
      id: "other-subject",
      subjectId: "linear",
      workbookId: "1000",
    });
    const assessment = findSegmentReassignConflicts(
      { segments: [source, first, second, otherSubject], questions: [] },
      [],
      source,
      "new",
    );

    expect(assessment.disabledReason).toBe("active-sibling");
    expect(assessment.activeSiblings.map((value) => value.segmentId)).toEqual([
      "first",
      "second",
    ]);
  });

  it("derives workbook option states without copying UI state", () => {
    const source = segment({ id: "source", workbookId: "880" });
    const trashed = trashedSegment({ workbookId: "1000" });
    const options = getSegmentReassignOptions(
      {
        workbooks: [
          workbook("880", "880题"),
          workbook("1000", "1000题"),
          workbook("new"),
        ],
        segments: [source],
        questions: [],
      },
      [trashed],
      source,
    );

    expect(
      options.map((option) => [option.workbook.id, option.canReassign]),
    ).toEqual([
      ["880", true],
      ["1000", false],
      ["new", true],
    ]);
    expect(options[1]).toMatchObject({
      workbook: { id: "1000", name: "1000题" },
      disabledReason: "trashed-target",
    });
  });

  it("filters and counts questions by segment without mutating the input", () => {
    const questions = [
      { ...question("1", "choice"), segmentId: "target" },
      { ...question("2", "blank"), segmentId: "other" },
      { ...question("3", "solution"), segmentId: "target" },
    ];

    expect(
      questionsInSegment(questions, "target").map((item) => item.id),
    ).toEqual(["1", "3"]);
    expect(countQuestionsInSegment(questions, "target")).toBe(2);
    expect(questions.map((item) => item.id)).toEqual(["1", "2", "3"]);
  });

  it("keeps an empty 1000-question segment pending instead of browsable", () => {
    expect(
      questionSegmentVisibility(
        { id: "segment-1000", indexState: "pending", questionCount: 0 },
        [],
      ),
    ).toBe("pending");
  });

  it("makes a populated 1000-question segment available to filtering", () => {
    const indexed = question("1", "choice");
    const hundredQuestions = [
      {
        ...indexed,
        workbookId: "1000",
        workbookName: "1000题",
        segmentId: "segment-1000",
      },
    ];

    expect(
      questionSegmentVisibility(
        { id: "segment-1000", indexState: "ready", questionCount: 1 },
        hundredQuestions,
      ),
    ).toBe("browsable");
    expect(
      questionsInScope(hundredQuestions, { workbookId: "1000" }),
    ).toHaveLength(1);
  });

  it("uses live rows when persisted count is stale at zero", () => {
    const indexed = question("1", "choice");

    expect(
      questionSegmentVisibility(
        { id: "segment-stale-zero", indexState: "ready", questionCount: 0 },
        [{ ...indexed, segmentId: "segment-stale-zero" }],
      ),
    ).toBe("browsable");
  });

  it("keeps a counted segment pending when no live rows remain", () => {
    expect(
      questionSegmentVisibility(
        { id: "segment-empty-ready", indexState: "ready", questionCount: 12 },
        [],
      ),
    ).toBe("pending");
  });

  it("keeps pending state conservative even when rows are present", () => {
    const indexed = question("1", "choice");

    expect(
      questionSegmentVisibility(
        { id: "segment-pending", indexState: "pending", questionCount: 1 },
        [{ ...indexed, segmentId: "segment-pending" }],
      ),
    ).toBe("pending");
  });

  it("summarizes only live questions in the target segment", () => {
    const summary = segmentDeletionSummary({ id: "segment-target" }, [
      {
        ...question("1", "choice"),
        segmentId: "segment-target",
        attemptCount: 3,
      },
      { ...question("2", "blank"), segmentId: "segment-target" },
      { ...question("3", "solution"), segmentId: "other", attemptCount: 8 },
    ]);

    expect(summary).toEqual({
      liveQuestionCount: 2,
      attemptedQuestionCount: 1,
      totalAttemptCount: 3,
      hasAttemptHistory: true,
    });
  });

  it("reports no attempt history for an empty or unattempted segment", () => {
    expect(
      segmentDeletionSummary({ id: "segment-empty" }, [
        { ...question("1", "choice"), segmentId: "other" },
      ]),
    ).toEqual({
      liveQuestionCount: 0,
      attemptedQuestionCount: 0,
      totalAttemptCount: 0,
      hasAttemptHistory: false,
    });
  });

  it("parses comma-separated values and inclusive ranges", () => {
    expect(parseQuestionNumberSelection("1, 3，5-7")).toEqual([
      "1",
      "3",
      "5",
      "6",
      "7",
    ]);
  });

  it("rejects a reversed number range", () => {
    expect(() => parseQuestionNumberSelection("7-3")).toThrow(
      "QUESTION_NUMBER_RANGE_INVALID",
    );
  });

  it("gives historical mistakes a larger paper-selection weight", () => {
    expect(
      questionWeight(question("1", "choice", "incorrect")),
    ).toBeGreaterThan(questionWeight(question("2", "choice", "correct")));
  });

  it("respects type quotas and removes duplicates", () => {
    const result = generateWeightedPaper(
      [
        question("1", "choice"),
        question("2", "choice"),
        question("3", "blank"),
        question("4", "solution"),
      ],
      {
        subjectId: "math",
        statuses: new Set(["unattempted"]),
        choiceCount: 1,
        blankCount: 1,
        solutionCount: 1,
      },
      () => 0,
    );

    expect(result.map((value) => value.questionType)).toEqual([
      "choice",
      "blank",
      "solution",
    ]);
  });

  it("combines questions from every checked subject", () => {
    const result = generateWeightedPaper(
      [
        question("1", "choice", undefined, "math"),
        question("2", "choice", undefined, "linear"),
        question("3", "choice", undefined, "probability"),
      ],
      {
        subjectIds: new Set(["math", "linear"]),
        statuses: new Set(["unattempted"]),
        choiceCount: 3,
        blankCount: 0,
        solutionCount: 0,
      },
      () => 0,
    );

    expect(result.map((value) => value.subjectId).sort()).toEqual([
      "linear",
      "math",
    ]);
  });

  it("applies independent type quotas for each selected subject", () => {
    const result = generateWeightedPaper(
      [
        question("1", "choice", undefined, "math"),
        question("2", "choice", undefined, "math"),
        question("3", "blank", undefined, "math"),
        question("4", "choice", undefined, "linear"),
        question("5", "choice", undefined, "linear"),
        question("6", "blank", undefined, "linear"),
      ],
      {
        subjectIds: new Set(["math", "linear"]),
        subjectQuotas: new Map([
          ["math", { choice: 1, blank: 0, solution: 0 }],
          ["linear", { choice: 2, blank: 1, solution: 0 }],
        ]),
        statuses: new Set(["unattempted"]),
        choiceCount: 0,
        blankCount: 0,
        solutionCount: 0,
      },
      () => 0,
    );

    expect(result).toHaveLength(4);
    expect(result.map((item) => item.questionType)).toEqual([
      "choice",
      "choice",
      "choice",
      "blank",
    ]);
    expect(result.map((item) => item.subjectId)).toEqual([
      "math",
      "linear",
      "linear",
      "linear",
    ]);
    expect(
      result.reduce<Record<string, number>>((counts, item) => {
        counts[item.subjectId] = (counts[item.subjectId] ?? 0) + 1;
        return counts;
      }, {}),
    ).toEqual({ math: 1, linear: 3 });
    expect(
      result
        .filter((item) => item.subjectId === "linear")
        .map((item) => item.questionType),
    ).toEqual(["choice", "choice", "blank"]);
  });

  it("intersects fields inside one composable paper scope", () => {
    const questions = [
      {
        ...question("1", "choice"),
        workbookId: "w1",
        workbookName: "练习册一",
        chapter: "第一章",
        sectionPart: "basic" as const,
      },
      {
        ...question("2", "choice"),
        workbookId: "w1",
        workbookName: "练习册一",
        chapter: "第二章",
        sectionPart: "basic" as const,
      },
      {
        ...question("3", "blank"),
        workbookId: "w2",
        workbookName: "练习册二",
        chapter: "第一章",
        sectionPart: "comprehensive" as const,
      },
    ];

    expect(
      questionsInPaperScope(questions, {
        workbookIds: new Set(["w1"]),
        chapterKeys: new Set([paperChapterKey("w1", "第一章")]),
        sectionParts: new Set(["basic"]),
        questionTypes: new Set(["choice"]),
      }).map((value) => value.id),
    ).toEqual(["1"]);
  });

  it("unions enabled paper scope groups and de-duplicates by question id", () => {
    const questions = [
      { ...question("1", "choice"), workbookId: "w1" },
      { ...question("2", "choice"), workbookId: "w2" },
      { ...question("3", "choice"), workbookId: "w3" },
    ];
    const group = (id: string, workbookId: string): PaperScopeGroup => ({
      id,
      name: id,
      enabled: true,
      mode: "include",
      workbookIds: new Set([workbookId]),
      chapterKeys: new Set<string>(),
      sectionParts: new Set<SectionPart>(),
      questionTypes: new Set<IndexedQuestion["questionType"]>(),
    });

    expect(
      questionsInPaperScopeGroups(questions, [
        group("one", "w1"),
        group("one-again", "w1"),
        group("two", "w2"),
        { ...group("disabled", "w3"), enabled: false },
      ]).map((value) => value.id),
    ).toEqual(["1", "2"]);

    expect(
      questionsInPaperScopeGroups(questions, [
        group("all", "w1"),
        { ...group("exclude", "w1"), mode: "exclude" },
        group("two", "w2"),
      ]).map((value) => value.id),
    ).toEqual(["2"]);
  });
});
