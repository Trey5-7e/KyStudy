import { invoke } from "@tauri-apps/api/core";

import {
  parseQuestionBundle,
  type QuestionBundle,
  type QuestionType,
} from "./questionClient";

export type ReviewSchemeRating = "failed" | "uncertain" | "mastered";
export type ReviewSchemeItemState = "pending" | "completed";

export interface ReviewSchemeTypeQuota {
  questionType: QuestionType;
  quota: number;
}

export interface ReviewScheme {
  id: string;
  name: string;
  subjectId: string;
  subjectName: string;
  allSubjectWorkbooks: boolean;
  dailyQuota: number;
  enabled: boolean;
  documentIds: string[];
  typeQuotas: ReviewSchemeTypeQuota[];
  createdAt: number;
  updatedAt: number;
}

export interface ReviewSchemeQueueItem {
  question: QuestionBundle;
  position: number;
  originDate: string;
  carried: boolean;
  state: ReviewSchemeItemState;
  insertedAt: number;
  completedAt?: number;
  rating?: ReviewSchemeRating;
}

export interface ReviewSchemeQueue {
  id: string;
  schemeId: string;
  queueDate: string;
  quota: number;
  generatedAt: number;
  completedCount: number;
  items: ReviewSchemeQueueItem[];
}

export interface ReviewSchemeToday {
  scheme: ReviewScheme;
  isRestDay: boolean;
  dueCount: number;
  pendingClassificationCount: number;
  queue?: ReviewSchemeQueue;
}

export interface ReviewSchemeDashboard {
  restWeekdays: number[];
  schemes: ReviewSchemeToday[];
}

export interface SaveReviewSchemeInput {
  schemeId?: string;
  name: string;
  subjectId: string;
  allSubjectWorkbooks: boolean;
  dailyQuota: number;
  enabled: boolean;
  documentIds: string[];
  typeQuotas: ReviewSchemeTypeQuota[];
  today: string;
}

export interface ReviewSchemeCommandError {
  code: string;
  message: string;
  action: string;
  operationId?: string;
}

const QUESTION_TYPES = new Set<QuestionType>([
  "choice",
  "blank",
  "solution",
  "other",
]);
const ITEM_STATES = new Set<ReviewSchemeItemState>(["pending", "completed"]);
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ERROR_COPY: Record<string, { message: string; action: string }> = {
  WORKSPACE_NOT_INITIALIZED: {
    message: "尚未创建本地工作区。",
    action: "先创建本地工作区，再设置错题方案。",
  },
  REVIEW_SCHEME_NOT_FOUND: {
    message: "找不到这份复习方案。",
    action: "刷新错题页后重新选择方案。",
  },
  REVIEW_SCHEME_CONFLICT: {
    message: "方案名称或今日队列状态发生冲突。",
    action: "更换方案名称或刷新后重试。",
  },
  REVIEW_SCHEME_SUBJECT_NOT_FOUND: {
    message: "方案选择的科目不存在或已归档。",
    action: "刷新科目列表后重新选择。",
  },
  REVIEW_SCHEME_WORKBOOK_NOT_FOUND: {
    message: "方案中的习题册不可用或不在当前范围。",
    action: "刷新习题册列表并重新选择范围。",
  },
  REVIEW_SCHEME_ITEM_NOT_FOUND: {
    message: "今日队列中找不到这道题。",
    action: "刷新错题页后从当前题继续。",
  },
  REVIEW_SCHEME_ITEM_COMPLETED: {
    message: "这道题已经提交反馈。",
    action: "继续下一题，不要重复提交。",
  },
  REVIEW_SCHEME_UNDO_UNAVAILABLE: {
    message: "没有可以撤销的反馈。",
    action: "继续当前复习，或刷新后重试。",
  },
  REVIEW_SCHEME_INPUT_INVALID: {
    message: "复习方案、题型配额或日期无效。",
    action: "确认题型数量之和等于每日总量后重试。",
  },
  DATABASE_BUSY: {
    message: "本地数据库正在被占用。",
    action: "关闭其他 KyStudy 窗口后重试。",
  },
  DATABASE_ERROR: {
    message: "本地错题方案暂时无法读取。",
    action: "重新启动应用；如果仍失败，请保留工作区。",
  },
};

export async function getReviewSchemeDashboard(
  today: string,
): Promise<ReviewSchemeDashboard> {
  return parseReviewSchemeDashboard(
    await invoke("get_review_scheme_dashboard", { today }),
  );
}

export async function saveReviewScheme(
  request: SaveReviewSchemeInput,
): Promise<ReviewSchemeDashboard> {
  return parseReviewSchemeDashboard(
    await invoke("save_review_scheme", { request }),
  );
}

export async function archiveReviewScheme(
  schemeId: string,
  today: string,
): Promise<ReviewSchemeDashboard> {
  return parseReviewSchemeDashboard(
    await invoke("archive_review_scheme", { schemeId, today }),
  );
}

export async function setReviewRestWeekdays(
  restWeekdays: number[],
  today: string,
): Promise<ReviewSchemeDashboard> {
  return parseReviewSchemeDashboard(
    await invoke("set_review_rest_weekdays", { restWeekdays, today }),
  );
}

export async function generateReviewSchemeQueue(request: {
  schemeId: string;
  queueDate: string;
  temporaryDocumentId?: string;
}): Promise<ReviewSchemeDashboard> {
  return parseReviewSchemeDashboard(
    await invoke("generate_review_scheme_queue", { request }),
  );
}

export function reviewSchemesNeedingQueue(
  dashboard: ReviewSchemeDashboard,
): string[] {
  return dashboard.schemes
    .filter(
      (item) =>
        item.scheme.enabled && !item.isRestDay && item.queue === undefined,
    )
    .map((item) => item.scheme.id);
}

export async function prepareReviewSchemeQueues(
  today: string,
  dashboard: ReviewSchemeDashboard,
): Promise<ReviewSchemeDashboard> {
  let latest = dashboard;
  for (const schemeId of reviewSchemesNeedingQueue(dashboard)) {
    latest = await generateReviewSchemeQueue({ schemeId, queueDate: today });
  }
  return latest;
}

export async function submitReviewSchemeResult(request: {
  queueId: string;
  questionId: string;
  rating: ReviewSchemeRating;
  today: string;
}): Promise<ReviewSchemeDashboard> {
  return parseReviewSchemeDashboard(
    await invoke("submit_review_scheme_result", { request }),
  );
}

export async function undoReviewSchemeResult(request: {
  queueId: string;
  today: string;
}): Promise<ReviewSchemeDashboard> {
  return parseReviewSchemeDashboard(
    await invoke("undo_review_scheme_result", { request }),
  );
}

export function normalizeReviewSchemeError(
  error: unknown,
): ReviewSchemeCommandError {
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
    code: "REVIEW_SCHEME_UNAVAILABLE",
    message: "本地错题方案暂时不可用。",
    action: "重新启动应用后重试。",
  };
}

export function parseReviewSchemeDashboard(
  value: unknown,
): ReviewSchemeDashboard {
  if (
    !isRecord(value) ||
    !Array.isArray(value.restWeekdays) ||
    !Array.isArray(value.schemes)
  ) {
    throw new Error("REVIEW_SCHEME_DASHBOARD_INVALID");
  }
  const restWeekdays = value.restWeekdays.map((weekday) => {
    if (!integerInRange(weekday, 0, 6)) {
      throw new Error("REVIEW_SCHEME_DASHBOARD_INVALID");
    }
    return weekday;
  });
  if (new Set(restWeekdays).size !== restWeekdays.length) {
    throw new Error("REVIEW_SCHEME_DASHBOARD_INVALID");
  }
  return {
    restWeekdays,
    schemes: value.schemes.map(parseToday),
  };
}

function parseToday(value: unknown): ReviewSchemeToday {
  if (
    !isRecord(value) ||
    typeof value.isRestDay !== "boolean" ||
    !nonnegativeInteger(value.dueCount) ||
    !nonnegativeInteger(value.pendingClassificationCount)
  ) {
    throw new Error("REVIEW_SCHEME_TODAY_INVALID");
  }
  return {
    scheme: parseScheme(value.scheme),
    isRestDay: value.isRestDay,
    dueCount: value.dueCount,
    pendingClassificationCount: value.pendingClassificationCount,
    queue:
      value.queue === null || value.queue === undefined
        ? undefined
        : parseQueue(value.queue),
  };
}

function parseScheme(value: unknown): ReviewScheme {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.subjectId !== "string" ||
    typeof value.subjectName !== "string" ||
    typeof value.allSubjectWorkbooks !== "boolean" ||
    !integerInRange(value.dailyQuota, 1, 100) ||
    typeof value.enabled !== "boolean" ||
    !Array.isArray(value.documentIds) ||
    !value.documentIds.every((item) => typeof item === "string") ||
    !Array.isArray(value.typeQuotas) ||
    !nonnegativeInteger(value.createdAt) ||
    !nonnegativeInteger(value.updatedAt)
  ) {
    throw new Error("REVIEW_SCHEME_INVALID");
  }
  const typeQuotas = value.typeQuotas.map(parseTypeQuota);
  if (
    typeQuotas.reduce((total, item) => total + item.quota, 0) !==
    value.dailyQuota
  ) {
    throw new Error("REVIEW_SCHEME_INVALID");
  }
  return {
    id: value.id,
    name: value.name,
    subjectId: value.subjectId,
    subjectName: value.subjectName,
    allSubjectWorkbooks: value.allSubjectWorkbooks,
    dailyQuota: value.dailyQuota,
    enabled: value.enabled,
    documentIds: value.documentIds as string[],
    typeQuotas,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseTypeQuota(value: unknown): ReviewSchemeTypeQuota {
  if (
    !isRecord(value) ||
    !QUESTION_TYPES.has(value.questionType as QuestionType) ||
    !integerInRange(value.quota, 0, 100)
  ) {
    throw new Error("REVIEW_SCHEME_QUOTA_INVALID");
  }
  return {
    questionType: value.questionType as QuestionType,
    quota: value.quota,
  };
}

function parseQueue(value: unknown): ReviewSchemeQueue {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.schemeId !== "string" ||
    !localDate(value.queueDate) ||
    !integerInRange(value.quota, 1, 100) ||
    !nonnegativeInteger(value.generatedAt) ||
    !nonnegativeInteger(value.completedCount) ||
    !Array.isArray(value.items)
  ) {
    throw new Error("REVIEW_SCHEME_QUEUE_INVALID");
  }
  const items = value.items.map(parseQueueItem);
  if (
    items.filter((item) => item.state === "completed").length !==
    value.completedCount
  ) {
    throw new Error("REVIEW_SCHEME_QUEUE_INVALID");
  }
  return {
    id: value.id,
    schemeId: value.schemeId,
    queueDate: value.queueDate,
    quota: value.quota,
    generatedAt: value.generatedAt,
    completedCount: value.completedCount,
    items,
  };
}

function parseQueueItem(value: unknown): ReviewSchemeQueueItem {
  if (
    !isRecord(value) ||
    !nonnegativeInteger(value.position) ||
    !localDate(value.originDate) ||
    typeof value.carried !== "boolean" ||
    !ITEM_STATES.has(value.state as ReviewSchemeItemState) ||
    !nonnegativeInteger(value.insertedAt) ||
    !optionalNonnegativeInteger(value.completedAt)
  ) {
    throw new Error("REVIEW_SCHEME_ITEM_INVALID");
  }
  return {
    question: parseQuestionBundle(value.question),
    position: value.position,
    originDate: value.originDate,
    carried: value.carried,
    state: value.state as ReviewSchemeItemState,
    insertedAt: value.insertedAt,
    completedAt:
      typeof value.completedAt === "number" ? value.completedAt : undefined,
    rating: parseOptionalRating(value.reviewEvent),
  };
}

function parseOptionalRating(value: unknown): ReviewSchemeRating | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("REVIEW_SCHEME_ITEM_INVALID");
  }
  const rating = value.rating;
  if (rating !== "failed" && rating !== "uncertain" && rating !== "mastered") {
    throw new Error("REVIEW_SCHEME_ITEM_INVALID");
  }
  return rating;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function optionalNonnegativeInteger(value: unknown): boolean {
  return value === null || value === undefined || nonnegativeInteger(value);
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function localDate(value: unknown): value is string {
  return typeof value === "string" && LOCAL_DATE.test(value);
}
