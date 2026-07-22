import { invoke } from "@tauri-apps/api/core";

import type { StudyPlan } from "./planningClient";
import {
  normalizeScheduleCommandError,
  type ScheduleCommandError,
} from "./scheduleClient";

export interface PlanProgressSummary {
  generatedTaskCount: number;
  effectiveTaskCount: number;
  completedTaskCount: number;
  remainingTaskCount: number;
  overdueTaskCount: number;
  canceledTaskCount: number;
  trashedTaskCount: number;
  plannedMinutes: number;
  actualMinutes: number;
  completionRatePercent?: number;
}

export interface PlanStageProgress {
  stageId: string;
  stageTitle: string;
  startDate: string;
  endDate: string;
  summary: PlanProgressSummary;
}

export interface PlanExecutionProgress {
  planId: string;
  planTitle: string;
  planStatus: StudyPlan["status"];
  summary: PlanProgressSummary;
  stages: PlanStageProgress[];
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLAN_STATUSES = new Set<StudyPlan["status"]>([
  "draft",
  "active",
  "archived",
]);
const SUMMARY_KEYS = [
  "generatedTaskCount",
  "effectiveTaskCount",
  "completedTaskCount",
  "remainingTaskCount",
  "overdueTaskCount",
  "canceledTaskCount",
  "trashedTaskCount",
  "plannedMinutes",
  "actualMinutes",
] as const;
const MAX_U32 = 4_294_967_295;

const ERROR_COPY: Record<string, { message: string; action: string }> = {
  PLAN_PROGRESS_INPUT_INVALID: {
    message: "计划进度请求无效。",
    action: "刷新个人计划后重新选择。",
  },
  PLAN_PROGRESS_NOT_FOUND: {
    message: "找不到这份个人计划。",
    action: "刷新计划列表后重新选择。",
  },
  PLAN_PROGRESS_DATA_INVALID: {
    message: "部分计划进度数据不完整。",
    action: "先创建完整备份，不要手动修改数据库。",
  },
};

export async function getPlanExecutionProgress(
  planId: string,
  today: string,
): Promise<PlanExecutionProgress> {
  return parsePlanExecutionProgress(
    await invoke("get_plan_execution_progress", {
      request: { planId, today },
    }),
  );
}

export function normalizePlanProgressError(
  error: unknown,
): ScheduleCommandError {
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

export function parsePlanExecutionProgress(
  value: unknown,
): PlanExecutionProgress {
  if (
    !isRecord(value) ||
    typeof value.planId !== "string" ||
    typeof value.planTitle !== "string" ||
    !PLAN_STATUSES.has(value.planStatus as StudyPlan["status"]) ||
    !Array.isArray(value.stages)
  ) {
    throw new Error("PLAN_EXECUTION_PROGRESS_INVALID");
  }
  const summary = parseSummary(value.summary);
  const stages = value.stages.map(parseStage);
  const aggregate = emptySummary();
  for (const stage of stages) {
    for (const key of SUMMARY_KEYS) {
      aggregate[key] += stage.summary[key];
      if (aggregate[key] > MAX_U32) {
        throw new Error("PLAN_EXECUTION_PROGRESS_INVALID");
      }
    }
  }
  if (SUMMARY_KEYS.some((key) => aggregate[key] !== summary[key])) {
    throw new Error("PLAN_EXECUTION_PROGRESS_INVALID");
  }
  return {
    planId: value.planId,
    planTitle: value.planTitle,
    planStatus: value.planStatus as StudyPlan["status"],
    summary,
    stages,
  };
}

function parseStage(value: unknown): PlanStageProgress {
  if (
    !isRecord(value) ||
    typeof value.stageId !== "string" ||
    typeof value.stageTitle !== "string" ||
    !isLocalDate(value.startDate) ||
    !isLocalDate(value.endDate) ||
    value.startDate > value.endDate
  ) {
    throw new Error("PLAN_STAGE_PROGRESS_INVALID");
  }
  return {
    stageId: value.stageId,
    stageTitle: value.stageTitle,
    startDate: value.startDate,
    endDate: value.endDate,
    summary: parseSummary(value.summary),
  };
}

function parseSummary(value: unknown): PlanProgressSummary {
  if (!isRecord(value) || SUMMARY_KEYS.some((key) => !isU32(value[key]))) {
    throw new Error("PLAN_PROGRESS_SUMMARY_INVALID");
  }
  const summary: PlanProgressSummary = {
    generatedTaskCount: value.generatedTaskCount as number,
    effectiveTaskCount: value.effectiveTaskCount as number,
    completedTaskCount: value.completedTaskCount as number,
    remainingTaskCount: value.remainingTaskCount as number,
    overdueTaskCount: value.overdueTaskCount as number,
    canceledTaskCount: value.canceledTaskCount as number,
    trashedTaskCount: value.trashedTaskCount as number,
    plannedMinutes: value.plannedMinutes as number,
    actualMinutes: value.actualMinutes as number,
    completionRatePercent: optionalPercent(value.completionRatePercent),
  };
  const classified =
    summary.effectiveTaskCount +
    summary.canceledTaskCount +
    summary.trashedTaskCount;
  const expectedPercent =
    summary.effectiveTaskCount === 0
      ? undefined
      : Math.floor(
          (summary.completedTaskCount * 100 +
            Math.floor(summary.effectiveTaskCount / 2)) /
            summary.effectiveTaskCount,
        );
  if (
    classified !== summary.generatedTaskCount ||
    summary.completedTaskCount + summary.remainingTaskCount !==
      summary.effectiveTaskCount ||
    summary.overdueTaskCount > summary.remainingTaskCount ||
    summary.completionRatePercent !== expectedPercent
  ) {
    throw new Error("PLAN_PROGRESS_SUMMARY_INVALID");
  }
  return summary;
}

function emptySummary(): PlanProgressSummary {
  return {
    generatedTaskCount: 0,
    effectiveTaskCount: 0,
    completedTaskCount: 0,
    remainingTaskCount: 0,
    overdueTaskCount: 0,
    canceledTaskCount: 0,
    trashedTaskCount: 0,
    plannedMinutes: 0,
    actualMinutes: 0,
  };
}

function optionalPercent(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!isU32(value) || value > 100) {
    throw new Error("PLAN_PROGRESS_SUMMARY_INVALID");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isU32(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_U32
  );
}

function isLocalDate(value: unknown): value is string {
  return typeof value === "string" && LOCAL_DATE.test(value);
}
