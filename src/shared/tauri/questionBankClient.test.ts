import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import {
  deleteAllTrashedWorkbookSegments,
  deleteTrashedWorkbookSegment,
  getQuestionGapAcknowledgements,
  listTrashedWorkbookSegments,
  normalizeQuestionBankError,
  parseQuestionBankSnapshot,
  parseQuestionGapAcknowledgements,
  parseTrashedWorkbookDocumentSegment,
  practiceStatus,
  reassignWorkbookSegment,
  restoreWorkbookSegment,
  setQuestionGapAcknowledgement,
  trashWorkbookSegment,
} from "./questionBankClient";

const mockedInvoke = vi.mocked(invoke);

const QUESTION = {
  id: "q",
  documentId: "d",
  documentTitle: "880",
  subjectId: "s",
  subjectName: "高等数学",
  workbookId: "w",
  workbookName: "880",
  segmentId: "g",
  chapter: "第一章",
  sectionPart: "basic",
  questionType: "blank",
  questionNumber: "3",
  title: "第 3 题",
  indexConfidence: 0.95,
  sortOrder: 2,
  attemptCount: 0,
  incorrectCount: 0,
  partialCount: 0,
  regions: [
    {
      id: "r",
      questionId: "q",
      documentId: "d",
      pageNumber: 4,
      x: 0.1,
      y: 0.2,
      width: 0.8,
      height: 0.2,
      coordinateVersion: 1,
      sortOrder: 0,
      createdAt: 1,
    },
  ],
};

const SEGMENT = {
  id: "g",
  documentId: "d",
  documentTitle: "880.pdf",
  subjectId: "s",
  subjectName: "高等数学",
  workbookId: "w",
  workbookName: "880",
  sourceHeading: "高等数学",
  pageStart: 1,
  pageEnd: 12,
  indexState: "ready",
  questionCount: 1,
  createdAt: 1,
  updatedAt: 1,
};

const TRASHED_SEGMENT = {
  ...SEGMENT,
  indexState: "pending",
  questionCount: 0,
  updatedAt: 50,
  deletedAt: 100,
  restorableQuestionCount: 1,
};

describe("question bank client", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("parses an indexed question with an unattempted current state", () => {
    const snapshot = parseQuestionBankSnapshot({
      workbooks: [{ id: "w", name: "880", createdAt: 1, updatedAt: 1 }],
      segments: [],
      questions: [QUESTION],
    });

    expect(practiceStatus(snapshot.questions[0]!)).toBe("unattempted");
  });

  it("rejects contradictory or unknown persisted outcomes", () => {
    expect(() =>
      parseQuestionBankSnapshot({
        workbooks: [],
        segments: [],
        questions: [{ ...QUESTION, currentResult: "skipped" }],
      }),
    ).toThrow("INDEXED_QUESTION_INVALID");
  });

  it("parses gap acknowledgements as a strict issue-key list", () => {
    expect(
      parseQuestionGapAcknowledgements({ issueKeys: ["region-missing"] }),
    ).toEqual(["region-missing"]);
    expect(() => parseQuestionGapAcknowledgements({ issueKeys: [42] })).toThrow(
      "QUESTION_GAP_ACKNOWLEDGEMENTS_INVALID",
    );
  });

  it("parses a trashed segment with a restore token and count", () => {
    expect(parseTrashedWorkbookDocumentSegment(TRASHED_SEGMENT)).toEqual(
      TRASHED_SEGMENT,
    );
  });

  it("rejects missing, fractional, or non-positive trash timestamps", () => {
    expect(() =>
      parseTrashedWorkbookDocumentSegment({
        ...TRASHED_SEGMENT,
        deletedAt: undefined,
      }),
    ).toThrow("TRASHED_WORKBOOK_SEGMENT_INVALID");
    expect(() =>
      parseTrashedWorkbookDocumentSegment({
        ...TRASHED_SEGMENT,
        deletedAt: 100.5,
      }),
    ).toThrow("TRASHED_WORKBOOK_SEGMENT_INVALID");
    expect(() =>
      parseTrashedWorkbookDocumentSegment({
        ...TRASHED_SEGMENT,
        deletedAt: 0,
      }),
    ).toThrow("TRASHED_WORKBOOK_SEGMENT_INVALID");
  });

  it("rejects malformed segment timestamps, pages, and restorable counts", () => {
    expect(() =>
      parseTrashedWorkbookDocumentSegment({
        ...TRASHED_SEGMENT,
        createdAt: "1",
      }),
    ).toThrow("WORKBOOK_SEGMENT_INVALID");
    expect(() =>
      parseTrashedWorkbookDocumentSegment({
        ...TRASHED_SEGMENT,
        updatedAt: 20.25,
      }),
    ).toThrow("WORKBOOK_SEGMENT_INVALID");
    expect(() =>
      parseTrashedWorkbookDocumentSegment({
        ...TRASHED_SEGMENT,
        pageStart: 0,
      }),
    ).toThrow("WORKBOOK_SEGMENT_INVALID");
    expect(() =>
      parseTrashedWorkbookDocumentSegment({
        ...TRASHED_SEGMENT,
        restorableQuestionCount: 1.5,
      }),
    ).toThrow("TRASHED_WORKBOOK_SEGMENT_INVALID");
  });

  it("bridges trashed segment listing and optimistic restore", async () => {
    const snapshot = {
      workbooks: [{ id: "w", name: "880", createdAt: 1, updatedAt: 1 }],
      segments: [SEGMENT],
      questions: [QUESTION],
    };
    mockedInvoke
      .mockResolvedValueOnce([TRASHED_SEGMENT])
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot);

    await expect(listTrashedWorkbookSegments()).resolves.toEqual([
      TRASHED_SEGMENT,
    ]);
    expect(mockedInvoke).toHaveBeenLastCalledWith(
      "list_trashed_workbook_segments",
    );

    await expect(restoreWorkbookSegment("g", 100)).resolves.toMatchObject({
      segments: [SEGMENT],
      questions: [{ id: "q" }],
    });
    expect(mockedInvoke).toHaveBeenLastCalledWith("restore_workbook_segment", {
      input: { segmentId: "g", expectedDeletedAt: 100 },
    });

    await expect(deleteTrashedWorkbookSegment("g", 100)).resolves.toMatchObject(
      {
        segments: [SEGMENT],
        questions: [{ id: "q" }],
      },
    );
    expect(mockedInvoke).toHaveBeenLastCalledWith("delete_workbook_segment", {
      input: { segmentId: "g", expectedDeletedAt: 100 },
    });

    await expect(deleteAllTrashedWorkbookSegments()).resolves.toMatchObject({
      segments: [SEGMENT],
      questions: [{ id: "q" }],
    });
    expect(mockedInvoke).toHaveBeenLastCalledWith(
      "delete_all_trashed_workbook_segments",
    );
  });

  it("bridges gap acknowledgement commands with camel-case request fields", async () => {
    mockedInvoke.mockResolvedValue({ issueKeys: ["region-missing"] });

    await expect(getQuestionGapAcknowledgements()).resolves.toEqual([
      "region-missing",
    ]);
    expect(mockedInvoke).toHaveBeenCalledWith(
      "get_question_gap_acknowledgements",
    );

    await expect(
      setQuestionGapAcknowledgement("region-missing", true),
    ).resolves.toEqual(["region-missing"]);
    expect(mockedInvoke).toHaveBeenLastCalledWith(
      "set_question_gap_acknowledgement",
      { request: { issueKey: "region-missing", acknowledged: true } },
    );
  });

  it("bridges segment trashing and parses the returned snapshot", async () => {
    mockedInvoke.mockResolvedValue({
      workbooks: [{ id: "w", name: "880", createdAt: 1, updatedAt: 1 }],
      segments: [SEGMENT],
      questions: [QUESTION],
    });

    await expect(trashWorkbookSegment("g")).resolves.toMatchObject({
      segments: [SEGMENT],
      questions: [{ id: "q" }],
    });
    expect(mockedInvoke).toHaveBeenCalledWith("trash_workbook_segment", {
      segmentId: "g",
    });
  });

  it("bridges workbook reassignment with an active-only precondition", async () => {
    mockedInvoke.mockResolvedValue({
      workbooks: [{ id: "w", name: "880", createdAt: 1, updatedAt: 1 }],
      segments: [SEGMENT],
      questions: [QUESTION],
    });

    await expect(
      reassignWorkbookSegment("g", "target", 73),
    ).resolves.toMatchObject({
      segments: [SEGMENT],
      questions: [{ id: "q" }],
    });
    expect(mockedInvoke).toHaveBeenCalledWith("reassign_workbook_segment", {
      input: {
        segmentId: "g",
        targetWorkbookId: "target",
        expectedUpdatedAt: 73,
        expectedDeletedAt: null,
      },
    });
  });

  it("surfaces malformed snapshots from segment trashing", async () => {
    mockedInvoke.mockResolvedValue({
      workbooks: [],
      segments: [SEGMENT],
      questions: [{ ...QUESTION, attemptCount: -1 }],
    });

    await expect(trashWorkbookSegment("g")).rejects.toThrow(
      "INDEXED_QUESTION_INVALID",
    );
  });

  it("keeps inactive segment errors actionable", () => {
    expect(
      normalizeQuestionBankError({
        code: "QUESTION_BANK_SEGMENT_NOT_ACTIVE",
        operationId: "operation-1",
      }),
    ).toEqual({
      code: "QUESTION_BANK_SEGMENT_NOT_ACTIVE",
      message: "这段 PDF 科目内容已经移入回收站。",
      action: "重新保存同一分段以恢复可见索引，或刷新题库后重试。",
      operationId: "operation-1",
    });
  });

  it("keeps trash restore errors actionable", () => {
    expect(
      normalizeQuestionBankError({ code: "QUESTION_BANK_SEGMENT_NOT_TRASHED" }),
    ).toMatchObject({
      code: "QUESTION_BANK_SEGMENT_NOT_TRASHED",
      message: "这段 PDF 科目内容不在回收站。",
    });
    expect(
      normalizeQuestionBankError({
        code: "QUESTION_BANK_SEGMENT_RESTORE_STALE",
      }),
    ).toMatchObject({
      code: "QUESTION_BANK_SEGMENT_RESTORE_STALE",
      message: "这段 PDF 分段的回收站状态已经变化。",
    });
  });

  it("keeps assignment conflicts actionable", () => {
    expect(
      normalizeQuestionBankError({
        code: "QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT",
        operationId: "operation-2",
      }),
    ).toEqual({
      code: "QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT",
      message: "这段 PDF 页码已经归入另一个练习册。",
      action: "请保留已有归类；如需更正，请先移除错误分段，再重新分析并重试。",
      operationId: "operation-2",
    });
  });

  it("keeps stale reassignment errors actionable", () => {
    expect(
      normalizeQuestionBankError({
        code: "QUESTION_BANK_SEGMENT_REASSIGN_STALE",
        operationId: "operation-3",
      }),
    ).toEqual({
      code: "QUESTION_BANK_SEGMENT_REASSIGN_STALE",
      message: "这段 PDF 分段的归类状态已经变化。",
      action: "刷新题库后重新打开分段管理，再确认目标练习册。",
      operationId: "operation-3",
    });
  });
});
