import { invoke } from "@tauri-apps/api/core";

export type TaskPriority = "low" | "normal" | "high";
export type TaskStatus = "todo" | "in_progress" | "done" | "canceled";
export type TaskTransition = "complete" | "reopen";

export interface StudyTask {
  id: string;
  subjectId?: string;
  parentTaskId?: string;
  title: string;
  description?: string;
  plannedDate: string;
  estimatedMinutes?: number;
  priority: TaskPriority;
  status: TaskStatus;
  manualOrder: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateTaskInput {
  subjectId?: string;
  title: string;
  description?: string;
  plannedDate: string;
  estimatedMinutes?: number;
  priority: TaskPriority;
  manualOrder: number;
}

export interface ScheduleCommandError {
  code: string;
  message: string;
  action: string;
  operationId?: string;
}

const PRIORITIES = new Set<TaskPriority>(["low", "normal", "high"]);
const STATUSES = new Set<TaskStatus>([
  "todo",
  "in_progress",
  "done",
  "canceled",
]);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ERROR_COPY: Record<string, { message: string; action: string }> = {
  WORKSPACE_NOT_INITIALIZED: {
    message: "尚未创建本地工作区。",
    action: "先创建本地工作区，再添加今日任务。",
  },
  SCHEDULE_INPUT_INVALID: {
    message: "任务内容不符合要求。",
    action: "检查标题、日期和预计时长后重试。",
  },
  TASK_TRANSITION_INVALID: {
    message: "当前任务状态不能执行这个操作。",
    action: "刷新任务列表后重试。",
  },
  TASK_NOT_FOUND: {
    message: "该任务不存在或已进入回收站。",
    action: "刷新任务列表后重试。",
  },
  SUBJECT_NOT_FOUND: {
    message: "所选科目不存在或已经归档。",
    action: "重新选择科目，或暂时使用未分类。",
  },
  DATABASE_BUSY: {
    message: "本地数据库正在被占用，请稍后重试。",
    action: "关闭其他 KyStudy 窗口后重试。",
  },
  DATABASE_ERROR: {
    message: "本地日程暂时无法访问。",
    action: "重新启动应用后重试。",
  },
  SCHEDULE_DATA_INVALID: {
    message: "本地日程数据未通过完整性校验。",
    action: "不要覆盖工作区；请先创建完整备份。",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | undefined | null {
  if (value === null || value === undefined) {
    return undefined;
  }
  return typeof value === "string" ? value : null;
}

function optionalSafeInteger(value: unknown): number | undefined | null {
  if (value === null || value === undefined) {
    return undefined;
  }
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

export function parseStudyTask(value: unknown): StudyTask {
  if (!isRecord(value)) {
    throw new Error("TASK_DTO_INVALID");
  }
  const subjectId = optionalString(value.subjectId);
  const parentTaskId = optionalString(value.parentTaskId);
  const description = optionalString(value.description);
  const estimatedMinutes = optionalSafeInteger(value.estimatedMinutes);
  const completedAt = optionalSafeInteger(value.completedAt);
  if (
    typeof value.id !== "string" ||
    subjectId === null ||
    parentTaskId === null ||
    typeof value.title !== "string" ||
    value.title.length === 0 ||
    description === null ||
    typeof value.plannedDate !== "string" ||
    !ISO_DATE_PATTERN.test(value.plannedDate) ||
    estimatedMinutes === null ||
    (estimatedMinutes !== undefined &&
      (estimatedMinutes < 1 || estimatedMinutes > 1440)) ||
    typeof value.priority !== "string" ||
    !PRIORITIES.has(value.priority as TaskPriority) ||
    typeof value.status !== "string" ||
    !STATUSES.has(value.status as TaskStatus) ||
    typeof value.manualOrder !== "number" ||
    !Number.isSafeInteger(value.manualOrder) ||
    value.manualOrder < 0 ||
    completedAt === null ||
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    typeof value.updatedAt !== "number" ||
    !Number.isSafeInteger(value.updatedAt)
  ) {
    throw new Error("TASK_DTO_INVALID");
  }
  if ((value.status === "done") !== (completedAt !== undefined)) {
    throw new Error("TASK_DTO_INVALID");
  }
  return {
    id: value.id,
    ...(subjectId === undefined ? {} : { subjectId }),
    ...(parentTaskId === undefined ? {} : { parentTaskId }),
    title: value.title,
    ...(description === undefined ? {} : { description }),
    plannedDate: value.plannedDate,
    ...(estimatedMinutes === undefined ? {} : { estimatedMinutes }),
    priority: value.priority as TaskPriority,
    status: value.status as TaskStatus,
    manualOrder: value.manualOrder,
    ...(completedAt === undefined ? {} : { completedAt }),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function parseTaskList(value: unknown): StudyTask[] {
  if (!Array.isArray(value)) {
    throw new Error("TASK_LIST_DTO_INVALID");
  }
  return value.map(parseStudyTask);
}

export function localDateForTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("LOCAL_DATE_UNAVAILABLE");
  }
  return `${year}-${month}-${day}`;
}

export async function listTasksForRange(
  startDate: string,
  endDate: string,
): Promise<StudyTask[]> {
  const value: unknown = await invoke("list_tasks_for_range", {
    startDate,
    endDate,
  });
  return parseTaskList(value);
}

export async function createTask(request: CreateTaskInput): Promise<StudyTask> {
  const value: unknown = await invoke("create_task", { request });
  return parseStudyTask(value);
}

export async function transitionTask(
  taskId: string,
  transition: TaskTransition,
): Promise<StudyTask> {
  const value: unknown = await invoke("transition_task", {
    taskId,
    transition,
  });
  return parseStudyTask(value);
}

export function normalizeScheduleCommandError(
  error: unknown,
): ScheduleCommandError {
  if (
    error instanceof Error &&
    (error.message === "TASK_DTO_INVALID" ||
      error.message === "TASK_LIST_DTO_INVALID" ||
      error.message === "LOCAL_DATE_UNAVAILABLE")
  ) {
    return {
      code: error.message,
      message: "本地核心返回了无法识别的日程数据。",
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
    code: "SCHEDULE_UNAVAILABLE",
    message: "本地日程暂时无法访问。",
    action: "重新启动应用后重试。",
  };
}
