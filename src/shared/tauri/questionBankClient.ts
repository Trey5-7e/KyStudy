import { invoke } from "@tauri-apps/api/core";

import type {
  AttemptResult,
  QuestionRegion,
  QuestionRegionInput,
  QuestionType,
} from "./questionClient";
import type { ResourceCommandError } from "./resourceClient";

export type SectionPart = "basic" | "comprehensive" | "extended" | "other";
export type PracticeStatus = "unattempted" | AttemptResult;

export interface WorkbookCategory {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkbookDocumentSegment {
  id: string;
  documentId: string;
  documentTitle: string;
  subjectId: string;
  subjectName: string;
  workbookId: string;
  workbookName: string;
  sourceHeading: string;
  pageStart: number;
  pageEnd: number;
  indexState: "pending" | "ready" | "needs_review";
  questionCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * A PDF segment that was moved to the question-bank trash.
 *
 * The active question-bank snapshot intentionally excludes trashed segments;
 * this DTO is returned by the dedicated trash-list command instead.  The
 * deleted timestamp is also the optimistic-concurrency token required when
 * restoring a segment.
 */
export interface TrashedWorkbookDocumentSegment extends WorkbookDocumentSegment {
  deletedAt: number;
  restorableQuestionCount: number;
}

export interface IndexedQuestion {
  id: string;
  documentId: string;
  documentTitle: string;
  subjectId: string;
  subjectName: string;
  workbookId: string;
  workbookName: string;
  segmentId: string;
  chapter: string;
  sectionPart: SectionPart;
  questionType: QuestionType;
  questionNumber: string;
  title: string;
  indexConfidence: number;
  sortOrder: number;
  currentResult?: AttemptResult;
  attemptCount: number;
  incorrectCount: number;
  partialCount: number;
  regions: QuestionRegion[];
}

export interface QuestionBankSnapshot {
  workbooks: WorkbookCategory[];
  segments: WorkbookDocumentSegment[];
  questions: IndexedQuestion[];
}

export interface WorkbookSegmentAssignment {
  documentId: string;
  subjectId: string;
  workbookId: string;
  sourceHeading: string;
  pageStart: number;
  pageEnd: number;
}

export interface IndexedQuestionDraft {
  sourceKey: string;
  title: string;
  chapter: string;
  sectionPart: SectionPart;
  questionType: QuestionType;
  questionNumber: string;
  indexConfidence: number;
  regions: QuestionRegionInput[];
}

export interface BulkQuestionAttempt {
  questionId: string;
  result: AttemptResult;
}

export interface IndexedQuestionUpdate {
  questionId: string;
  title: string;
  chapter: string;
  sectionPart: SectionPart;
  questionType: QuestionType;
  questionNumber: string;
}

export interface IndexedQuestionRegionUpdate extends QuestionRegionInput {
  regionId?: string;
}

export interface InsertIndexedQuestionRequest {
  anchorQuestionId: string;
  placement: "before" | "after";
  title: string;
  chapter: string;
  sectionPart: SectionPart;
  questionType: QuestionType;
  questionNumber: string;
  regions: QuestionRegionInput[];
}

const QUESTION_TYPES = new Set<QuestionType>([
  "choice",
  "blank",
  "solution",
  "other",
]);
const ATTEMPT_RESULTS = new Set<AttemptResult>([
  "correct",
  "incorrect",
  "uncertain",
]);
const SECTION_PARTS = new Set<SectionPart>([
  "basic",
  "comprehensive",
  "extended",
  "other",
]);
const INDEX_STATES = new Set(["pending", "ready", "needs_review"]);

const ERROR_COPY: Record<string, { message: string; action: string }> = {
  QUESTION_BANK_INPUT_INVALID: {
    message: "题库索引或做题记录格式无效。",
    action: "检查页面范围、题号与分类后重试。",
  },
  WORKBOOK_CATEGORY_EXISTS: {
    message: "已经有同名练习册。",
    action: "直接选择已有练习册，或使用能够区分版本的名称。",
  },
  WORKBOOK_CATEGORY_NOT_FOUND: {
    message: "找不到所选练习册分类。",
    action: "刷新题库，或重新创建练习册分类。",
  },
  QUESTION_BANK_DOCUMENT_NOT_FOUND: {
    message: "找不到要解析的 PDF。",
    action: "确认资料仍在资料库中，然后重新选择。",
  },
  QUESTION_BANK_SUBJECT_NOT_FOUND: {
    message: "找不到所选科目。",
    action: "刷新科目列表，或先创建科目分类。",
  },
  QUESTION_BANK_SEGMENT_NOT_FOUND: {
    message: "找不到这段 PDF 科目内容。",
    action: "重新分析 PDF 并确认归类。",
  },
  QUESTION_BANK_SEGMENT_NOT_ACTIVE: {
    message: "这段 PDF 科目内容已经移入回收站。",
    action: "重新保存同一分段以恢复可见索引，或刷新题库后重试。",
  },
  QUESTION_BANK_SEGMENT_NOT_TRASHED: {
    message: "这段 PDF 科目内容不在回收站。",
    action: "刷新题库回收站；只有已移除的分段可以恢复。",
  },
  QUESTION_BANK_SEGMENT_RESTORE_STALE: {
    message: "这段 PDF 分段的回收站状态已经变化。",
    action: "刷新题库回收站后重试，避免恢复过期状态。",
  },
  QUESTION_BANK_SEGMENT_REASSIGN_STALE: {
    message: "这段 PDF 分段的归类状态已经变化。",
    action: "刷新题库后重新打开分段管理，再确认目标练习册。",
  },
  QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT: {
    message: "这段 PDF 页码已经归入另一个练习册。",
    action: "请保留已有归类；如需更正，请先移除错误分段，再重新分析并重试。",
  },
  QUESTION_BANK_QUESTION_NOT_FOUND: {
    message: "找不到要登记的索引题目。",
    action: "刷新题库后重新选择题号。",
  },
};

export async function getQuestionBank(): Promise<QuestionBankSnapshot> {
  return parseQuestionBankSnapshot(await invoke("get_question_bank"));
}

export async function listTrashedWorkbookSegments(): Promise<
  TrashedWorkbookDocumentSegment[]
> {
  return parseTrashedWorkbookDocumentSegmentList(
    await invoke("list_trashed_workbook_segments"),
  );
}

export async function restoreWorkbookSegment(
  segmentId: string,
  expectedDeletedAt: number,
): Promise<QuestionBankSnapshot> {
  return parseQuestionBankSnapshot(
    await invoke("restore_workbook_segment", {
      input: { segmentId, expectedDeletedAt },
    }),
  );
}

export async function deleteTrashedWorkbookSegment(
  segmentId: string,
  expectedDeletedAt: number,
): Promise<QuestionBankSnapshot> {
  return parseQuestionBankSnapshot(
    await invoke("delete_workbook_segment", {
      input: { segmentId, expectedDeletedAt },
    }),
  );
}

export async function deleteAllTrashedWorkbookSegments(): Promise<QuestionBankSnapshot> {
  return parseQuestionBankSnapshot(
    await invoke("delete_all_trashed_workbook_segments"),
  );
}

export async function reassignWorkbookSegment(
  segmentId: string,
  targetWorkbookId: string,
  expectedUpdatedAt: number,
): Promise<QuestionBankSnapshot> {
  return parseQuestionBankSnapshot(
    await invoke("reassign_workbook_segment", {
      input: {
        segmentId,
        targetWorkbookId,
        expectedUpdatedAt,
        expectedDeletedAt: null,
      },
    }),
  );
}

export async function getQuestionGapAcknowledgements(): Promise<string[]> {
  return parseQuestionGapAcknowledgements(
    await invoke("get_question_gap_acknowledgements"),
  );
}

export async function setQuestionGapAcknowledgement(
  issueKey: string,
  acknowledged: boolean,
): Promise<string[]> {
  return parseQuestionGapAcknowledgements(
    await invoke("set_question_gap_acknowledgement", {
      request: { issueKey, acknowledged },
    }),
  );
}

export async function createWorkbookCategory(
  name: string,
): Promise<WorkbookCategory> {
  return parseWorkbookCategory(
    await invoke("create_workbook_category", { request: { name } }),
  );
}

export async function archiveWorkbookCategory(
  workbookId: string,
): Promise<WorkbookCategory> {
  return parseWorkbookCategory(
    await invoke("archive_workbook_category", { workbookId }),
  );
}

export async function renameWorkbookCategory(
  workbookId: string,
  name: string,
): Promise<WorkbookCategory> {
  return parseWorkbookCategory(
    await invoke("rename_workbook_category", {
      request: { workbookId, name },
    }),
  );
}

export async function saveWorkbookSegments(
  assignments: WorkbookSegmentAssignment[],
): Promise<WorkbookDocumentSegment[]> {
  const value: unknown = await invoke("save_workbook_segments", {
    assignments,
  });
  if (!Array.isArray(value)) throw new Error("QUESTION_BANK_SEGMENTS_INVALID");
  return value.map(parseWorkbookSegment);
}

export async function importQuestionIndex(
  segmentId: string,
  questions: IndexedQuestionDraft[],
): Promise<QuestionBankSnapshot> {
  return parseQuestionBankSnapshot(
    await invoke("import_question_index", {
      request: { segmentId, questions },
    }),
  );
}

export async function recordBulkQuestionAttempts(
  attemptedOn: string,
  entries: BulkQuestionAttempt[],
): Promise<QuestionBankSnapshot> {
  return parseQuestionBankSnapshot(
    await invoke("record_bulk_question_attempts", {
      request: { attemptedOn, entries },
    }),
  );
}

export async function updateIndexedQuestion(
  request: IndexedQuestionUpdate,
): Promise<QuestionBankSnapshot> {
  return parseQuestionBankSnapshot(
    await invoke("update_indexed_question", { request }),
  );
}

export async function replaceIndexedQuestionRegions(
  questionId: string,
  regions: IndexedQuestionRegionUpdate[],
): Promise<QuestionBankSnapshot> {
  return parseQuestionBankSnapshot(
    await invoke("replace_indexed_question_regions", {
      request: { questionId, regions },
    }),
  );
}

export async function insertIndexedQuestion(
  request: InsertIndexedQuestionRequest,
): Promise<QuestionBankSnapshot> {
  return parseQuestionBankSnapshot(
    await invoke("insert_indexed_question", { request }),
  );
}

export async function trashIndexedQuestion(
  questionId: string,
): Promise<QuestionBankSnapshot> {
  return parseQuestionBankSnapshot(
    await invoke("trash_indexed_question", { questionId }),
  );
}

export async function trashWorkbookSegment(
  segmentId: string,
): Promise<QuestionBankSnapshot> {
  return parseQuestionBankSnapshot(
    await invoke("trash_workbook_segment", { segmentId }),
  );
}

export function practiceStatus(question: IndexedQuestion): PracticeStatus {
  return question.currentResult ?? "unattempted";
}

export function normalizeQuestionBankError(
  error: unknown,
): ResourceCommandError {
  if (isRecord(error) && typeof error.code === "string") {
    const copy = ERROR_COPY[error.code];
    if (copy !== undefined) {
      return {
        code: error.code,
        ...copy,
        operationId:
          typeof error.operationId === "string" ? error.operationId : undefined,
      };
    }
  }
  return {
    code: "QUESTION_BANK_UNAVAILABLE",
    message: "本地题库暂时无法使用。",
    action: "重新启动应用后再试，已有 PDF 和题目不会丢失。",
  };
}

export function parseQuestionBankSnapshot(
  value: unknown,
): QuestionBankSnapshot {
  if (
    !isRecord(value) ||
    !Array.isArray(value.workbooks) ||
    !Array.isArray(value.segments) ||
    !Array.isArray(value.questions)
  ) {
    throw new Error("QUESTION_BANK_SNAPSHOT_INVALID");
  }
  return {
    workbooks: value.workbooks.map(parseWorkbookCategory),
    segments: value.segments.map(parseWorkbookSegment),
    questions: value.questions.map(parseIndexedQuestion),
  };
}

export function parseQuestionGapAcknowledgements(value: unknown): string[] {
  if (
    !isRecord(value) ||
    !Array.isArray(value.issueKeys) ||
    !value.issueKeys.every((issueKey) => typeof issueKey === "string")
  ) {
    throw new Error("QUESTION_GAP_ACKNOWLEDGEMENTS_INVALID");
  }
  return value.issueKeys;
}

export function parseTrashedWorkbookDocumentSegmentList(
  value: unknown,
): TrashedWorkbookDocumentSegment[] {
  if (!Array.isArray(value)) {
    throw new Error("TRASHED_WORKBOOK_SEGMENT_LIST_INVALID");
  }
  return value.map(parseTrashedWorkbookDocumentSegment);
}

// Short aliases keep the parser discoverable alongside parseWorkbookSegment
// while retaining the full DTO name for callers that prefer explicit types.
export const parseTrashedWorkbookSegmentList =
  parseTrashedWorkbookDocumentSegmentList;

function parseWorkbookCategory(value: unknown): WorkbookCategory {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !isNonNegativeInteger(value.createdAt) ||
    !isNonNegativeInteger(value.updatedAt)
  ) {
    throw new Error("WORKBOOK_CATEGORY_INVALID");
  }
  return {
    id: value.id,
    name: value.name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseWorkbookSegment(value: unknown): WorkbookDocumentSegment {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.documentId !== "string" ||
    typeof value.documentTitle !== "string" ||
    typeof value.subjectId !== "string" ||
    typeof value.subjectName !== "string" ||
    typeof value.workbookId !== "string" ||
    typeof value.workbookName !== "string" ||
    typeof value.sourceHeading !== "string" ||
    !isPositiveInteger(value.pageStart) ||
    !isPositiveInteger(value.pageEnd) ||
    value.pageEnd < value.pageStart ||
    !INDEX_STATES.has(
      typeof value.indexState === "string" ? value.indexState : "",
    ) ||
    !isNonNegativeInteger(value.questionCount) ||
    !isNonNegativeInteger(value.createdAt) ||
    !isNonNegativeInteger(value.updatedAt)
  ) {
    throw new Error("WORKBOOK_SEGMENT_INVALID");
  }
  return value as unknown as WorkbookDocumentSegment;
}

export function parseTrashedWorkbookDocumentSegment(
  value: unknown,
): TrashedWorkbookDocumentSegment {
  if (!isRecord(value)) {
    throw new Error("TRASHED_WORKBOOK_SEGMENT_INVALID");
  }
  const segment = parseWorkbookSegment(value);
  if (
    !isPositiveInteger(value.deletedAt) ||
    !isNonNegativeInteger(value.restorableQuestionCount)
  ) {
    throw new Error("TRASHED_WORKBOOK_SEGMENT_INVALID");
  }
  return {
    ...segment,
    deletedAt: value.deletedAt,
    restorableQuestionCount: value.restorableQuestionCount,
  };
}

export const parseTrashedWorkbookSegment = parseTrashedWorkbookDocumentSegment;

function parseIndexedQuestion(value: unknown): IndexedQuestion {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.documentId !== "string" ||
    typeof value.documentTitle !== "string" ||
    typeof value.subjectId !== "string" ||
    typeof value.subjectName !== "string" ||
    typeof value.workbookId !== "string" ||
    typeof value.workbookName !== "string" ||
    typeof value.segmentId !== "string" ||
    typeof value.chapter !== "string" ||
    !SECTION_PARTS.has(value.sectionPart as SectionPart) ||
    !QUESTION_TYPES.has(value.questionType as QuestionType) ||
    typeof value.questionNumber !== "string" ||
    typeof value.title !== "string" ||
    !isNormalized(value.indexConfidence) ||
    !isNonNegativeInteger(value.sortOrder) ||
    !isOptionalAttemptResult(value.currentResult) ||
    !isNonNegativeInteger(value.attemptCount) ||
    !isNonNegativeInteger(value.incorrectCount) ||
    !isNonNegativeInteger(value.partialCount) ||
    !Array.isArray(value.regions)
  ) {
    throw new Error("INDEXED_QUESTION_INVALID");
  }
  return {
    ...(value as unknown as Omit<IndexedQuestion, "regions">),
    currentResult:
      typeof value.currentResult === "string"
        ? (value.currentResult as AttemptResult)
        : undefined,
    regions: value.regions.map(parseQuestionRegion),
  };
}

function parseQuestionRegion(value: unknown): QuestionRegion {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.questionId !== "string" ||
    typeof value.documentId !== "string" ||
    !isPositiveInteger(value.pageNumber) ||
    !isNormalized(value.x) ||
    !isNormalized(value.y) ||
    !isPositiveNormalized(value.width) ||
    !isPositiveNormalized(value.height) ||
    value.x + value.width > 1.000_001 ||
    value.y + value.height > 1.000_001 ||
    value.coordinateVersion !== 1 ||
    !isNonNegativeInteger(value.sortOrder) ||
    !isNonNegativeInteger(value.createdAt)
  ) {
    throw new Error("QUESTION_REGION_INVALID");
  }
  return value as unknown as QuestionRegion;
}

function isOptionalAttemptResult(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    ATTEMPT_RESULTS.has(value as AttemptResult)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function isNormalized(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isPositiveNormalized(value: unknown): value is number {
  return isNormalized(value) && value > 0;
}
