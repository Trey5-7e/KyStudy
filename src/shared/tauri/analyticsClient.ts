import { invoke } from "@tauri-apps/api/core";

import {
  normalizeScheduleCommandError,
  type ScheduleCommandError,
  type SubjectColor,
} from "./scheduleClient";

export type AnalyticsDays = 7 | 28 | 90;

export interface AnalyticsPeriodSummary {
  taskCount: number;
  completedTaskCount: number;
  completionRatePercent?: number;
  plannedMinutes: number;
  actualMinutes: number;
  attemptCount: number;
  correctAttemptCount: number;
  accuracyPercent?: number;
  reviewItemCount: number;
  completedReviewCount: number;
  reviewCompletionPercent?: number;
  aiTokens: number;
}

export interface AnalyticsBacklog {
  overdueTasks: number;
  activeMistakes: number;
  dueReviews: number;
  queuedReviews: number;
}

export interface DailyAnalyticsPoint {
  date: string;
  taskCount: number;
  completedTaskCount: number;
  plannedMinutes: number;
  actualMinutes: number;
  attemptCount: number;
  correctAttemptCount: number;
  reviewItemCount: number;
  completedReviewCount: number;
  aiTokens: number;
}

export interface SubjectAnalytics {
  subjectId?: string;
  subjectName: string;
  colorKey: SubjectColor;
  taskCount: number;
  completedTaskCount: number;
  completionRatePercent?: number;
  actualMinutes: number;
}

export interface KnowledgeAnalytics {
  nodeId: string;
  nodeTitle: string;
  mapId: string;
  mapTitle: string;
  subjectName?: string;
  questionCount: number;
  attemptCount: number;
  correctAttemptCount: number;
  accuracyPercent?: number;
  activeMistakeCount: number;
}

export interface RepeatedMistakeAnalytics {
  questionId: string;
  questionTitle: string;
  documentId: string;
  documentTitle: string;
  mistakeCount: number;
  consecutiveFailureCount: number;
  mastery: "new" | "learning" | "uncertain" | "mastered";
  dueDate: string;
  lastMistakeAt?: number;
}

export interface AnalyticsOverview {
  rangeStart: string;
  rangeEnd: string;
  previousRangeStart: string;
  previousRangeEnd: string;
  current: AnalyticsPeriodSummary;
  previous: AnalyticsPeriodSummary;
  backlog: AnalyticsBacklog;
  daily: DailyAnalyticsPoint[];
  subjects: SubjectAnalytics[];
  knowledge: KnowledgeAnalytics[];
  repeatedMistakes: RepeatedMistakeAnalytics[];
}

const COLORS = new Set<SubjectColor>([
  "slate",
  "blue",
  "cyan",
  "green",
  "amber",
  "orange",
  "rose",
  "purple",
]);
const MASTERY = new Set<RepeatedMistakeAnalytics["mastery"]>([
  "new",
  "learning",
  "uncertain",
  "mastered",
]);
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const ERROR_COPY: Record<string, { message: string; action: string }> = {
  ANALYTICS_INPUT_INVALID: {
    message: "分析日期或统计周期无效。",
    action: "选择最近 7 天、28 天或 90 天后重试。",
  },
  ANALYTICS_DATA_INVALID: {
    message: "部分学习统计数据超出安全范围。",
    action: "先创建完整备份，不要手动修改数据库。",
  },
};

export async function getAnalyticsOverview(
  today: string,
  days: AnalyticsDays,
): Promise<AnalyticsOverview> {
  return parseAnalyticsOverview(
    await invoke("get_analytics_overview", { request: { today, days } }),
  );
}

export function normalizeAnalyticsError(error: unknown): ScheduleCommandError {
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
  return normalizeScheduleCommandError(error);
}

export function parseAnalyticsOverview(value: unknown): AnalyticsOverview {
  if (
    !isRecord(value) ||
    !isDate(value.rangeStart) ||
    !isDate(value.rangeEnd) ||
    !isDate(value.previousRangeStart) ||
    !isDate(value.previousRangeEnd) ||
    !Array.isArray(value.daily) ||
    !Array.isArray(value.subjects) ||
    !Array.isArray(value.knowledge) ||
    !Array.isArray(value.repeatedMistakes)
  ) {
    throw new Error("ANALYTICS_OVERVIEW_INVALID");
  }
  return {
    rangeStart: value.rangeStart,
    rangeEnd: value.rangeEnd,
    previousRangeStart: value.previousRangeStart,
    previousRangeEnd: value.previousRangeEnd,
    current: parseSummary(value.current),
    previous: parseSummary(value.previous),
    backlog: parseBacklog(value.backlog),
    daily: value.daily.map(parseDaily),
    subjects: value.subjects.map(parseSubject),
    knowledge: value.knowledge.map(parseKnowledge),
    repeatedMistakes: value.repeatedMistakes.map(parseRepeatedMistake),
  };
}

function parseSummary(value: unknown): AnalyticsPeriodSummary {
  if (
    !isRecord(value) ||
    !nonNegativeInteger(value.taskCount) ||
    !nonNegativeInteger(value.completedTaskCount) ||
    !optionalPercent(value.completionRatePercent) ||
    !nonNegativeInteger(value.plannedMinutes) ||
    !nonNegativeInteger(value.actualMinutes) ||
    !nonNegativeInteger(value.attemptCount) ||
    !nonNegativeInteger(value.correctAttemptCount) ||
    !optionalPercent(value.accuracyPercent) ||
    !nonNegativeInteger(value.reviewItemCount) ||
    !nonNegativeInteger(value.completedReviewCount) ||
    !optionalPercent(value.reviewCompletionPercent) ||
    !nonNegativeInteger(value.aiTokens) ||
    value.completedTaskCount > value.taskCount ||
    value.correctAttemptCount > value.attemptCount ||
    value.completedReviewCount > value.reviewItemCount
  ) {
    throw new Error("ANALYTICS_SUMMARY_INVALID");
  }
  return {
    taskCount: value.taskCount,
    completedTaskCount: value.completedTaskCount,
    completionRatePercent: optionalNumber(value.completionRatePercent),
    plannedMinutes: value.plannedMinutes,
    actualMinutes: value.actualMinutes,
    attemptCount: value.attemptCount,
    correctAttemptCount: value.correctAttemptCount,
    accuracyPercent: optionalNumber(value.accuracyPercent),
    reviewItemCount: value.reviewItemCount,
    completedReviewCount: value.completedReviewCount,
    reviewCompletionPercent: optionalNumber(value.reviewCompletionPercent),
    aiTokens: value.aiTokens,
  };
}

function parseBacklog(value: unknown): AnalyticsBacklog {
  if (
    !isRecord(value) ||
    !nonNegativeInteger(value.overdueTasks) ||
    !nonNegativeInteger(value.activeMistakes) ||
    !nonNegativeInteger(value.dueReviews) ||
    !nonNegativeInteger(value.queuedReviews)
  ) {
    throw new Error("ANALYTICS_BACKLOG_INVALID");
  }
  return {
    overdueTasks: value.overdueTasks,
    activeMistakes: value.activeMistakes,
    dueReviews: value.dueReviews,
    queuedReviews: value.queuedReviews,
  };
}

function parseDaily(value: unknown): DailyAnalyticsPoint {
  if (!isRecord(value) || !isDate(value.date)) {
    throw new Error("ANALYTICS_DAILY_INVALID");
  }
  const summary = parseSummary({
    ...value,
    completionRatePercent: undefined,
    accuracyPercent: undefined,
    reviewCompletionPercent: undefined,
  });
  return {
    date: value.date,
    taskCount: summary.taskCount,
    completedTaskCount: summary.completedTaskCount,
    plannedMinutes: summary.plannedMinutes,
    actualMinutes: summary.actualMinutes,
    attemptCount: summary.attemptCount,
    correctAttemptCount: summary.correctAttemptCount,
    reviewItemCount: summary.reviewItemCount,
    completedReviewCount: summary.completedReviewCount,
    aiTokens: summary.aiTokens,
  };
}

function parseSubject(value: unknown): SubjectAnalytics {
  if (
    !isRecord(value) ||
    !optionalString(value.subjectId) ||
    typeof value.subjectName !== "string" ||
    !COLORS.has(value.colorKey as SubjectColor) ||
    !nonNegativeInteger(value.taskCount) ||
    !nonNegativeInteger(value.completedTaskCount) ||
    !optionalPercent(value.completionRatePercent) ||
    !nonNegativeInteger(value.actualMinutes)
  ) {
    throw new Error("ANALYTICS_SUBJECT_INVALID");
  }
  return {
    subjectId: optionalValue(value.subjectId),
    subjectName: value.subjectName,
    colorKey: value.colorKey as SubjectColor,
    taskCount: value.taskCount,
    completedTaskCount: value.completedTaskCount,
    completionRatePercent: optionalNumber(value.completionRatePercent),
    actualMinutes: value.actualMinutes,
  };
}

function parseKnowledge(value: unknown): KnowledgeAnalytics {
  if (
    !isRecord(value) ||
    typeof value.nodeId !== "string" ||
    typeof value.nodeTitle !== "string" ||
    typeof value.mapId !== "string" ||
    typeof value.mapTitle !== "string" ||
    !optionalString(value.subjectName) ||
    !nonNegativeInteger(value.questionCount) ||
    !nonNegativeInteger(value.attemptCount) ||
    !nonNegativeInteger(value.correctAttemptCount) ||
    !optionalPercent(value.accuracyPercent) ||
    !nonNegativeInteger(value.activeMistakeCount)
  ) {
    throw new Error("ANALYTICS_KNOWLEDGE_INVALID");
  }
  return {
    nodeId: value.nodeId,
    nodeTitle: value.nodeTitle,
    mapId: value.mapId,
    mapTitle: value.mapTitle,
    subjectName: optionalValue(value.subjectName),
    questionCount: value.questionCount,
    attemptCount: value.attemptCount,
    correctAttemptCount: value.correctAttemptCount,
    accuracyPercent: optionalNumber(value.accuracyPercent),
    activeMistakeCount: value.activeMistakeCount,
  };
}

function parseRepeatedMistake(value: unknown): RepeatedMistakeAnalytics {
  if (
    !isRecord(value) ||
    typeof value.questionId !== "string" ||
    typeof value.questionTitle !== "string" ||
    typeof value.documentId !== "string" ||
    typeof value.documentTitle !== "string" ||
    !nonNegativeInteger(value.mistakeCount) ||
    !nonNegativeInteger(value.consecutiveFailureCount) ||
    !MASTERY.has(value.mastery as RepeatedMistakeAnalytics["mastery"]) ||
    !isDate(value.dueDate) ||
    !optionalNonNegativeInteger(value.lastMistakeAt)
  ) {
    throw new Error("ANALYTICS_MISTAKE_INVALID");
  }
  return {
    questionId: value.questionId,
    questionTitle: value.questionTitle,
    documentId: value.documentId,
    documentTitle: value.documentTitle,
    mistakeCount: value.mistakeCount,
    consecutiveFailureCount: value.consecutiveFailureCount,
    mastery: value.mastery as RepeatedMistakeAnalytics["mastery"],
    dueDate: value.dueDate,
    lastMistakeAt: optionalNumber(value.lastMistakeAt),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || value === null || nonNegativeInteger(value);
}

function optionalPercent(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (nonNegativeInteger(value) && value <= 100)
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function optionalValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && LOCAL_DATE.test(value);
}
