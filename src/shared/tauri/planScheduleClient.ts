import { invoke } from "@tauri-apps/api/core";

import {
  normalizeScheduleCommandError,
  parseStudyTask,
  type ScheduleCommandError,
  type StudyTask,
  type TaskPriority,
} from "./scheduleClient";

export interface PlanTaskScheduleInput {
  stageId: string;
  subjectId?: string;
  startDate: string;
  endDate: string;
  weekdays: number[];
  title: string;
  description?: string;
  estimatedMinutes?: number;
  priority: TaskPriority;
}

export interface PlanTaskPreviewItem {
  plannedDate: string;
  alreadyExists: boolean;
}

export interface PlanTaskPreview {
  stageId: string;
  planTitle: string;
  stageTitle: string;
  items: PlanTaskPreviewItem[];
  createCount: number;
  existingCount: number;
}

export interface PlanTaskCreation {
  createdTasks: StudyTask[];
  skippedExisting: number;
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ERROR_COPY: Record<string, { message: string; action: string }> = {
  PLAN_SCHEDULE_INPUT_INVALID: {
    message: "阶段展开设置不完整或超出阶段日期。",
    action: "检查日期、星期、标题、时长和优先级后重新预览。",
  },
  PLAN_STAGE_NOT_FOUND: {
    message: "找不到这个计划阶段。",
    action: "刷新个人计划后重新选择阶段。",
  },
  PLAN_SCHEDULE_PLAN_NOT_ACTIVE: {
    message: "只有当前计划可以展开到日程。",
    action: "先把这份计划确认为当前计划，再重新预览。",
  },
  PLAN_SCHEDULE_TOO_LARGE: {
    message: "本次将创建的任务数量过多。",
    action: "缩短日期范围或减少每周执行天数后重新预览。",
  },
  PLAN_SCHEDULE_DATA_INVALID: {
    message: "计划与日程的关联数据不完整。",
    action: "先创建完整备份，不要手动修改数据库。",
  },
};

export async function previewPlanStageTasks(
  request: PlanTaskScheduleInput,
): Promise<PlanTaskPreview> {
  return parsePlanTaskPreview(
    await invoke("preview_plan_stage_tasks", { request }),
  );
}

export async function confirmPlanStageTasks(
  request: PlanTaskScheduleInput,
): Promise<PlanTaskCreation> {
  return parsePlanTaskCreation(
    await invoke("confirm_plan_stage_tasks", { request }),
  );
}

export function normalizePlanScheduleError(
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

export function parsePlanTaskPreview(value: unknown): PlanTaskPreview {
  if (
    !isRecord(value) ||
    typeof value.stageId !== "string" ||
    typeof value.planTitle !== "string" ||
    typeof value.stageTitle !== "string" ||
    !Array.isArray(value.items) ||
    !isNonNegativeInteger(value.createCount) ||
    !isNonNegativeInteger(value.existingCount)
  ) {
    throw new Error("PLAN_TASK_PREVIEW_INVALID");
  }
  const items = value.items.map(parsePreviewItem);
  if (
    value.createCount + value.existingCount !== items.length ||
    value.existingCount !== items.filter((item) => item.alreadyExists).length
  ) {
    throw new Error("PLAN_TASK_PREVIEW_INVALID");
  }
  return {
    stageId: value.stageId,
    planTitle: value.planTitle,
    stageTitle: value.stageTitle,
    items,
    createCount: value.createCount,
    existingCount: value.existingCount,
  };
}

export function parsePlanTaskCreation(value: unknown): PlanTaskCreation {
  if (
    !isRecord(value) ||
    !Array.isArray(value.createdTasks) ||
    !isNonNegativeInteger(value.skippedExisting)
  ) {
    throw new Error("PLAN_TASK_CREATION_INVALID");
  }
  return {
    createdTasks: value.createdTasks.map(parseStudyTask),
    skippedExisting: value.skippedExisting,
  };
}

function parsePreviewItem(value: unknown): PlanTaskPreviewItem {
  if (
    !isRecord(value) ||
    !isLocalDate(value.plannedDate) ||
    typeof value.alreadyExists !== "boolean"
  ) {
    throw new Error("PLAN_TASK_PREVIEW_ITEM_INVALID");
  }
  return {
    plannedDate: value.plannedDate,
    alreadyExists: value.alreadyExists,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isLocalDate(value: unknown): value is string {
  return typeof value === "string" && LOCAL_DATE.test(value);
}
