import { invoke } from "@tauri-apps/api/core";

import { parseQuestionBundle, type QuestionBundle } from "./questionClient";

export type ReviewRating = "mastered" | "uncertain" | "failed" | "skipped";
export type ReviewMastery = "new" | "learning" | "uncertain" | "mastered";
export type ReviewSelection =
  "pinned" | "overdue" | "due" | "new" | "early" | "manual";
export type ReviewItemState = "pending" | "completed";

export interface ReviewPreferences {
  dailyQuota: number;
  earlyFillEnabled: boolean;
}

export interface MistakeProfile {
  questionId: string;
  firstMistakeAt?: number;
  lastMistakeAt?: number;
  mistakeCount: number;
  consecutiveFailureCount: number;
  active: boolean;
  userPriority: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReviewState {
  questionId: string;
  policyVersion: number;
  mastery: ReviewMastery;
  dueDate: string;
  lastReviewedAt?: number;
  successfulStreak: number;
  manualPinDate?: string;
  suspendedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReviewEvent {
  id: string;
  questionId: string;
  attemptId?: string;
  rating: ReviewRating;
  previousDueDate: string;
  nextDueDate: string;
  intervalDays: number;
  policyVersion: number;
  createdAt: number;
}

export interface ReviewReason {
  selection: ReviewSelection;
  overdueDays: number;
  failureStreak: number;
  mistakeCount: number;
  userPriority: number;
  knowledgeWeakness: number;
  daysSinceAttempt: number;
  isEarly: boolean;
}

export interface ReviewQuestion {
  question: QuestionBundle;
  profile: MistakeProfile;
  state: ReviewState;
  recentEvents: ReviewEvent[];
}

export interface DailyReviewItem {
  question: QuestionBundle;
  available: boolean;
  position: number;
  priorityScore: number;
  reason: ReviewReason;
  state: ReviewItemState;
  reviewEvent?: ReviewEvent;
  insertedAt: number;
  completedAt?: number;
}

export interface DailyReviewQueue {
  id: string;
  queueDate: string;
  quota: number;
  generatedAt: number;
  completedCount: number;
  items: DailyReviewItem[];
}

export interface ReviewBacklog {
  activeCount: number;
  dueCount: number;
  overdueCount: number;
  queuedRemaining: number;
  estimatedClearDays: number;
}

export interface ReviewDashboard {
  preferences: ReviewPreferences;
  backlog: ReviewBacklog;
  queue?: DailyReviewQueue;
  activeQuestions: ReviewQuestion[];
}

export interface ReviewCommandError {
  code: string;
  message: string;
  action: string;
  operationId?: string;
}

export interface SubmitReviewInput {
  queueId: string;
  questionId: string;
  rating: ReviewRating;
  today: string;
  durationSeconds?: number;
  answerNote?: string;
}

const RATINGS = new Set<ReviewRating>([
  "mastered",
  "uncertain",
  "failed",
  "skipped",
]);
const MASTERY = new Set<ReviewMastery>([
  "new",
  "learning",
  "uncertain",
  "mastered",
]);
const SELECTIONS = new Set<ReviewSelection>([
  "pinned",
  "overdue",
  "due",
  "new",
  "early",
  "manual",
]);
const ITEM_STATES = new Set<ReviewItemState>(["pending", "completed"]);
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ERROR_COPY: Record<string, { message: string; action: string }> = {
  WORKSPACE_NOT_INITIALIZED: {
    message: "尚未创建本地工作区。",
    action: "先创建工作区，再使用错题复习。",
  },
  REVIEW_QUESTION_NOT_FOUND: {
    message: "找不到可复习的题目。",
    action: "确认题目仍在有效习题册中，然后刷新。",
  },
  REVIEW_MISTAKE_NOT_FOUND: {
    message: "这道题当前不在错题复习中。",
    action: "刷新错题列表，或先把题目加入复习。",
  },
  REVIEW_QUEUE_NOT_FOUND: {
    message: "今天的复习队列尚未生成。",
    action: "先生成今日队列后重试。",
  },
  REVIEW_QUEUE_ITEM_NOT_FOUND: {
    message: "今日队列中找不到这道题。",
    action: "刷新复习页后重新选择。",
  },
  REVIEW_QUEUE_ITEM_COMPLETED: {
    message: "这道题今天已经完成复习。",
    action: "查看复习历史，不要重复提交。",
  },
  REVIEW_QUEUE_ITEM_EXISTS: {
    message: "这道题已经在今日复习队列中。",
    action: "直接在今日队列中完成它，无需重复追加。",
  },
  REVIEW_INPUT_INVALID: {
    message: "复习设置、日期或反馈格式无效。",
    action: "检查配额、重要度、耗时和日期后重试。",
  },
  DATABASE_BUSY: {
    message: "本地数据库正在被占用，请稍后重试。",
    action: "关闭其他 KyStudy 窗口后重试。",
  },
  DATABASE_ERROR: {
    message: "本地复习数据暂时无法读取。",
    action: "重新启动应用；如果仍失败，请保留工作区。",
  },
};

export async function getReviewDashboard(
  today: string,
): Promise<ReviewDashboard> {
  return parseReviewDashboard(await invoke("get_review_dashboard", { today }));
}

export async function updateReviewPreferences(request: {
  dailyQuota: number;
  earlyFillEnabled: boolean;
  today: string;
}): Promise<ReviewDashboard> {
  return parseReviewDashboard(
    await invoke("update_review_preferences", { request }),
  );
}

export async function setQuestionReview(request: {
  questionId: string;
  active: boolean;
  userPriority: number;
  today: string;
}): Promise<ReviewDashboard> {
  return parseReviewDashboard(await invoke("set_question_review", { request }));
}

export async function pinQuestionReview(request: {
  questionId: string;
  pinDate?: string;
  today: string;
}): Promise<ReviewDashboard> {
  return parseReviewDashboard(await invoke("pin_question_review", { request }));
}

export async function generateDailyReviewQueue(request: {
  queueDate: string;
  quota?: number;
}): Promise<ReviewDashboard> {
  return parseReviewDashboard(
    await invoke("generate_daily_review_queue", { request }),
  );
}

export async function insertDailyReviewItem(request: {
  queueDate: string;
  questionId: string;
}): Promise<ReviewDashboard> {
  return parseReviewDashboard(
    await invoke("insert_daily_review_item", { request }),
  );
}

export async function submitReviewResult(
  request: SubmitReviewInput,
): Promise<ReviewDashboard> {
  return parseReviewDashboard(
    await invoke("submit_review_result", { request }),
  );
}

export function parseReviewDashboard(value: unknown): ReviewDashboard {
  if (!isRecord(value)) {
    throw new Error("REVIEW_DASHBOARD_INVALID");
  }
  const preferences = parsePreferences(value.preferences);
  const backlog = parseBacklog(value.backlog);
  if (!Array.isArray(value.activeQuestions)) {
    throw new Error("REVIEW_DASHBOARD_INVALID");
  }
  const queue =
    value.queue === null || value.queue === undefined
      ? undefined
      : parseQueue(value.queue);
  return {
    preferences,
    backlog,
    queue,
    activeQuestions: value.activeQuestions.map(parseReviewQuestion),
  };
}

export function normalizeReviewError(error: unknown): ReviewCommandError {
  if (error instanceof Error && error.message.startsWith("REVIEW_")) {
    return {
      code: error.message,
      message: "本地核心返回了无法识别的复习数据。",
      action: "重新启动应用后重试。",
    };
  }
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
    code: "REVIEW_UNAVAILABLE",
    message: "本地复习功能暂时不可用。",
    action: "重新启动应用后重试。",
  };
}

function parsePreferences(value: unknown): ReviewPreferences {
  if (
    !isRecord(value) ||
    !boundedInteger(value.dailyQuota, 1, 100) ||
    typeof value.earlyFillEnabled !== "boolean"
  ) {
    throw new Error("REVIEW_PREFERENCES_INVALID");
  }
  return {
    dailyQuota: value.dailyQuota,
    earlyFillEnabled: value.earlyFillEnabled,
  };
}

function parseBacklog(value: unknown): ReviewBacklog {
  if (
    !isRecord(value) ||
    !nonnegativeInteger(value.activeCount) ||
    !nonnegativeInteger(value.dueCount) ||
    !nonnegativeInteger(value.overdueCount) ||
    !nonnegativeInteger(value.queuedRemaining) ||
    !nonnegativeInteger(value.estimatedClearDays)
  ) {
    throw new Error("REVIEW_BACKLOG_INVALID");
  }
  return {
    activeCount: value.activeCount,
    dueCount: value.dueCount,
    overdueCount: value.overdueCount,
    queuedRemaining: value.queuedRemaining,
    estimatedClearDays: value.estimatedClearDays,
  };
}

function parseReviewQuestion(value: unknown): ReviewQuestion {
  if (!isRecord(value) || !Array.isArray(value.recentEvents)) {
    throw new Error("REVIEW_QUESTION_INVALID");
  }
  const question = parseQuestionBundle(value.question);
  const profile = parseProfile(value.profile);
  const state = parseState(value.state);
  if (
    question.question.id !== profile.questionId ||
    profile.questionId !== state.questionId
  ) {
    throw new Error("REVIEW_QUESTION_INVALID");
  }
  return {
    question,
    profile,
    state,
    recentEvents: value.recentEvents.map(parseEvent),
  };
}

function parseProfile(value: unknown): MistakeProfile {
  if (
    !isRecord(value) ||
    typeof value.questionId !== "string" ||
    !optionalInteger(value.firstMistakeAt) ||
    !optionalInteger(value.lastMistakeAt) ||
    !nonnegativeInteger(value.mistakeCount) ||
    !nonnegativeInteger(value.consecutiveFailureCount) ||
    typeof value.active !== "boolean" ||
    !boundedInteger(value.userPriority, 1, 5) ||
    !safeInteger(value.createdAt) ||
    !safeInteger(value.updatedAt)
  ) {
    throw new Error("REVIEW_PROFILE_INVALID");
  }
  return {
    questionId: value.questionId,
    firstMistakeAt: optionalNumber(value.firstMistakeAt),
    lastMistakeAt: optionalNumber(value.lastMistakeAt),
    mistakeCount: value.mistakeCount,
    consecutiveFailureCount: value.consecutiveFailureCount,
    active: value.active,
    userPriority: value.userPriority,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseState(value: unknown): ReviewState {
  if (
    !isRecord(value) ||
    typeof value.questionId !== "string" ||
    !boundedInteger(value.policyVersion, 1, Number.MAX_SAFE_INTEGER) ||
    !MASTERY.has(value.mastery as ReviewMastery) ||
    !localDate(value.dueDate) ||
    !optionalInteger(value.lastReviewedAt) ||
    !nonnegativeInteger(value.successfulStreak) ||
    !optionalLocalDate(value.manualPinDate) ||
    !optionalInteger(value.suspendedAt) ||
    !safeInteger(value.createdAt) ||
    !safeInteger(value.updatedAt)
  ) {
    throw new Error("REVIEW_STATE_INVALID");
  }
  return {
    questionId: value.questionId,
    policyVersion: value.policyVersion,
    mastery: value.mastery as ReviewMastery,
    dueDate: value.dueDate,
    lastReviewedAt: optionalNumber(value.lastReviewedAt),
    successfulStreak: value.successfulStreak,
    manualPinDate:
      typeof value.manualPinDate === "string" ? value.manualPinDate : undefined,
    suspendedAt: optionalNumber(value.suspendedAt),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseEvent(value: unknown): ReviewEvent {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.questionId !== "string" ||
    !(
      value.attemptId === null ||
      value.attemptId === undefined ||
      typeof value.attemptId === "string"
    ) ||
    !RATINGS.has(value.rating as ReviewRating) ||
    !localDate(value.previousDueDate) ||
    !localDate(value.nextDueDate) ||
    !boundedInteger(value.intervalDays, 1, 3650) ||
    !boundedInteger(value.policyVersion, 1, Number.MAX_SAFE_INTEGER) ||
    !safeInteger(value.createdAt)
  ) {
    throw new Error("REVIEW_EVENT_INVALID");
  }
  return {
    id: value.id,
    questionId: value.questionId,
    attemptId:
      typeof value.attemptId === "string" ? value.attemptId : undefined,
    rating: value.rating as ReviewRating,
    previousDueDate: value.previousDueDate,
    nextDueDate: value.nextDueDate,
    intervalDays: value.intervalDays,
    policyVersion: value.policyVersion,
    createdAt: value.createdAt,
  };
}

function parseQueue(value: unknown): DailyReviewQueue {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !localDate(value.queueDate) ||
    !boundedInteger(value.quota, 1, 100) ||
    !safeInteger(value.generatedAt) ||
    !nonnegativeInteger(value.completedCount) ||
    !Array.isArray(value.items)
  ) {
    throw new Error("REVIEW_QUEUE_INVALID");
  }
  const items = value.items.map(parseQueueItem);
  if (
    value.completedCount !==
    items.filter((item) => item.state === "completed").length
  ) {
    throw new Error("REVIEW_QUEUE_INVALID");
  }
  return {
    id: value.id,
    queueDate: value.queueDate,
    quota: value.quota,
    generatedAt: value.generatedAt,
    completedCount: value.completedCount,
    items,
  };
}

function parseQueueItem(value: unknown): DailyReviewItem {
  if (
    !isRecord(value) ||
    typeof value.available !== "boolean" ||
    !nonnegativeInteger(value.position) ||
    !nonnegativeInteger(value.priorityScore) ||
    !ITEM_STATES.has(value.state as ReviewItemState) ||
    !safeInteger(value.insertedAt) ||
    !optionalInteger(value.completedAt)
  ) {
    throw new Error("REVIEW_QUEUE_ITEM_INVALID");
  }
  const reviewEvent =
    value.reviewEvent === null || value.reviewEvent === undefined
      ? undefined
      : parseEvent(value.reviewEvent);
  if (
    (value.state === "completed") !==
    (reviewEvent !== undefined && typeof value.completedAt === "number")
  ) {
    throw new Error("REVIEW_QUEUE_ITEM_INVALID");
  }
  return {
    question: parseQuestionBundle(value.question),
    available: value.available,
    position: value.position,
    priorityScore: value.priorityScore,
    reason: parseReason(value.reason),
    state: value.state as ReviewItemState,
    reviewEvent,
    insertedAt: value.insertedAt,
    completedAt: optionalNumber(value.completedAt),
  };
}

function parseReason(value: unknown): ReviewReason {
  if (
    !isRecord(value) ||
    !SELECTIONS.has(value.selection as ReviewSelection) ||
    !nonnegativeInteger(value.overdueDays) ||
    !nonnegativeInteger(value.failureStreak) ||
    !nonnegativeInteger(value.mistakeCount) ||
    !boundedInteger(value.userPriority, 1, 5) ||
    !boundedInteger(value.knowledgeWeakness, 0, 2) ||
    !nonnegativeInteger(value.daysSinceAttempt) ||
    typeof value.isEarly !== "boolean"
  ) {
    throw new Error("REVIEW_REASON_INVALID");
  }
  return {
    selection: value.selection as ReviewSelection,
    overdueDays: value.overdueDays,
    failureStreak: value.failureStreak,
    mistakeCount: value.mistakeCount,
    userPriority: value.userPriority,
    knowledgeWeakness: value.knowledgeWeakness,
    daysSinceAttempt: value.daysSinceAttempt,
    isEarly: value.isEarly,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function nonnegativeInteger(value: unknown): value is number {
  return safeInteger(value) && value >= 0;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return safeInteger(value) && value >= minimum && value <= maximum;
}

function optionalInteger(value: unknown): boolean {
  return value === null || value === undefined || safeInteger(value);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function localDate(value: unknown): value is string {
  return typeof value === "string" && LOCAL_DATE.test(value);
}

function optionalLocalDate(value: unknown): boolean {
  return value === null || value === undefined || localDate(value);
}
