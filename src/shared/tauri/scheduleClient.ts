import { invoke } from "@tauri-apps/api/core";

export type TaskPriority = "low" | "normal" | "high";
export type TaskStatus = "todo" | "in_progress" | "done" | "canceled";
export type TaskTransition =
  "start" | "complete" | "reopen" | "cancel" | "restore";
export type TaskChangeType =
  | "created"
  | "edited"
  | "rescheduled"
  | "started"
  | "completed"
  | "reopened"
  | "canceled"
  | "restored"
  | "split"
  | "trashed";
export type SubjectColor =
  "slate" | "blue" | "cyan" | "green" | "amber" | "orange" | "rose" | "purple";

export interface StudySubject {
  id: string;
  name: string;
  colorKey: SubjectColor;
  sortOrder: number;
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
}

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

export interface TaskChangeSnapshot {
  subjectId?: string;
  title: string;
  description?: string;
  plannedDate: string;
  estimatedMinutes?: number;
  priority: TaskPriority;
  status: TaskStatus;
  manualOrder: number;
  completedAt?: number;
}

export interface StudyTaskChange {
  id: string;
  changeType: TaskChangeType;
  before?: TaskChangeSnapshot;
  after?: TaskChangeSnapshot;
  reason?: string;
  createdAt: number;
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

export interface CreateSubjectInput {
  name: string;
  colorKey: SubjectColor;
  sortOrder: number;
}

export interface UpdateTaskDetailsInput {
  subjectId?: string;
  title: string;
  description?: string;
  estimatedMinutes?: number;
  priority: TaskPriority;
}

export interface RescheduleTaskInput {
  plannedDate: string;
  reason: string;
}

export interface SplitChildInput {
  title: string;
  description?: string;
  estimatedMinutes?: number;
}

export interface SplitTaskInput {
  children: SplitChildInput[];
}

export interface TaskSplitResult {
  parent: StudyTask;
  children: StudyTask[];
}

export interface TrashedStudyTask extends StudyTask {
  deletedAt: number;
}

export interface CreateStudySessionInput {
  taskId?: string;
  subjectId?: string;
  sessionDate: string;
  durationMinutes: number;
  completionPercent: number;
  reflection?: string;
}

export interface StudySession {
  id: string;
  taskId?: string;
  subjectId?: string;
  sessionDate: string;
  durationMinutes: number;
  completionPercent: number;
  reflection?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SubjectStatistics {
  subjectId?: string;
  subjectName: string;
  colorKey: SubjectColor;
  taskCount: number;
  actualMinutes: number;
}

export interface StudyStatistics {
  taskCount: number;
  completedTaskCount: number;
  completionRatePercent?: number;
  plannedMinutes: number;
  actualMinutes: number;
  minuteDifference: number;
  overdueTaskCount: number;
  subjects: SubjectStatistics[];
}

export interface ScheduleCommandError {
  code: string;
  message: string;
  action: string;
  operationId?: string;
}

const PRIORITIES = new Set<TaskPriority>(["low", "normal", "high"]);
const SUBJECT_COLORS = new Set<SubjectColor>([
  "slate",
  "blue",
  "cyan",
  "green",
  "amber",
  "orange",
  "rose",
  "purple",
]);
const STATUSES = new Set<TaskStatus>([
  "todo",
  "in_progress",
  "done",
  "canceled",
]);
const CHANGE_TYPES = new Set<TaskChangeType>([
  "created",
  "edited",
  "rescheduled",
  "started",
  "completed",
  "reopened",
  "canceled",
  "restored",
  "split",
  "trashed",
]);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ERROR_COPY: Record<string, { message: string; action: string }> = {
  WORKSPACE_NOT_INITIALIZED: {
    message: "尚未创建本地工作区。",
    action: "先创建本地工作区，再添加今日任务。",
  },
  SCHEDULE_INPUT_INVALID: {
    message: "任务内容不符合要求。",
    action: "检查标题、日期、原因和预计时长后重试。",
  },
  SUBJECT_NAME_CONFLICT: {
    message: "已经存在同名的有效科目。",
    action: "换一个科目名称，或先归档现有科目。",
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

export function parseStudySubject(value: unknown): StudySubject {
  if (!isRecord(value)) {
    throw new Error("SUBJECT_DTO_INVALID");
  }
  const archivedAt = optionalSafeInteger(value.archivedAt);
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    value.name.length > 40 ||
    typeof value.colorKey !== "string" ||
    !SUBJECT_COLORS.has(value.colorKey as SubjectColor) ||
    typeof value.sortOrder !== "number" ||
    !Number.isSafeInteger(value.sortOrder) ||
    value.sortOrder < 0 ||
    archivedAt === null ||
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0 ||
    typeof value.updatedAt !== "number" ||
    !Number.isSafeInteger(value.updatedAt) ||
    value.updatedAt < value.createdAt ||
    (archivedAt !== undefined &&
      (archivedAt < value.createdAt || archivedAt > value.updatedAt))
  ) {
    throw new Error("SUBJECT_DTO_INVALID");
  }
  return {
    id: value.id,
    name: value.name,
    colorKey: value.colorKey as SubjectColor,
    sortOrder: value.sortOrder,
    ...(archivedAt === undefined ? {} : { archivedAt }),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function parseSubjectList(value: unknown): StudySubject[] {
  if (!Array.isArray(value)) {
    throw new Error("SUBJECT_LIST_DTO_INVALID");
  }
  return value.map(parseStudySubject);
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
    value.id.length === 0 ||
    subjectId === null ||
    parentTaskId === null ||
    typeof value.title !== "string" ||
    value.title.length === 0 ||
    value.title.length > 120 ||
    description === null ||
    (description !== undefined && description.length > 2000) ||
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
    value.createdAt < 0 ||
    typeof value.updatedAt !== "number" ||
    !Number.isSafeInteger(value.updatedAt) ||
    value.updatedAt < value.createdAt
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

export function parseTrashedStudyTask(value: unknown): TrashedStudyTask {
  if (!isRecord(value)) {
    throw new Error("TRASHED_TASK_DTO_INVALID");
  }
  const task = parseStudyTask(value);
  if (
    typeof value.deletedAt !== "number" ||
    !Number.isSafeInteger(value.deletedAt) ||
    value.deletedAt < task.updatedAt
  ) {
    throw new Error("TRASHED_TASK_DTO_INVALID");
  }
  return { ...task, deletedAt: value.deletedAt };
}

export function parseTrashedTaskList(value: unknown): TrashedStudyTask[] {
  if (!Array.isArray(value)) {
    throw new Error("TRASHED_TASK_LIST_DTO_INVALID");
  }
  return value.map(parseTrashedStudyTask);
}

export function parseTaskSplitResult(value: unknown): TaskSplitResult {
  if (!isRecord(value)) {
    throw new Error("TASK_SPLIT_DTO_INVALID");
  }
  const parent = parseStudyTask(value.parent);
  const children = parseTaskList(value.children);
  if (
    children.length < 2 ||
    parent.status !== "canceled" ||
    children.some(
      (child) =>
        child.parentTaskId !== parent.id ||
        child.subjectId !== parent.subjectId ||
        child.plannedDate !== parent.plannedDate ||
        child.priority !== parent.priority,
    )
  ) {
    throw new Error("TASK_SPLIT_DTO_INVALID");
  }
  return { parent, children };
}

export function parseStudySession(value: unknown): StudySession {
  if (!isRecord(value)) {
    throw new Error("STUDY_SESSION_DTO_INVALID");
  }
  const taskId = optionalString(value.taskId);
  const subjectId = optionalString(value.subjectId);
  const reflection = optionalString(value.reflection);
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    taskId === null ||
    subjectId === null ||
    typeof value.sessionDate !== "string" ||
    !ISO_DATE_PATTERN.test(value.sessionDate) ||
    typeof value.durationMinutes !== "number" ||
    !Number.isSafeInteger(value.durationMinutes) ||
    value.durationMinutes < 1 ||
    value.durationMinutes > 1440 ||
    typeof value.completionPercent !== "number" ||
    !Number.isSafeInteger(value.completionPercent) ||
    value.completionPercent < 0 ||
    value.completionPercent > 100 ||
    reflection === null ||
    (reflection !== undefined && reflection.length > 2000) ||
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0 ||
    typeof value.updatedAt !== "number" ||
    !Number.isSafeInteger(value.updatedAt) ||
    value.updatedAt < value.createdAt
  ) {
    throw new Error("STUDY_SESSION_DTO_INVALID");
  }
  return {
    id: value.id,
    ...(taskId === undefined ? {} : { taskId }),
    ...(subjectId === undefined ? {} : { subjectId }),
    sessionDate: value.sessionDate,
    durationMinutes: value.durationMinutes,
    completionPercent: value.completionPercent,
    ...(reflection === undefined ? {} : { reflection }),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function parseStudySessionList(value: unknown): StudySession[] {
  if (!Array.isArray(value)) {
    throw new Error("STUDY_SESSION_LIST_DTO_INVALID");
  }
  return value.map(parseStudySession);
}

function parseSubjectStatistics(value: unknown): SubjectStatistics {
  if (!isRecord(value)) {
    throw new Error("STUDY_STATISTICS_DTO_INVALID");
  }
  const subjectId = optionalString(value.subjectId);
  if (
    subjectId === null ||
    typeof value.subjectName !== "string" ||
    value.subjectName.length === 0 ||
    typeof value.colorKey !== "string" ||
    !SUBJECT_COLORS.has(value.colorKey as SubjectColor) ||
    typeof value.taskCount !== "number" ||
    !Number.isSafeInteger(value.taskCount) ||
    value.taskCount < 0 ||
    typeof value.actualMinutes !== "number" ||
    !Number.isSafeInteger(value.actualMinutes) ||
    value.actualMinutes < 0
  ) {
    throw new Error("STUDY_STATISTICS_DTO_INVALID");
  }
  return {
    ...(subjectId === undefined ? {} : { subjectId }),
    subjectName: value.subjectName,
    colorKey: value.colorKey as SubjectColor,
    taskCount: value.taskCount,
    actualMinutes: value.actualMinutes,
  };
}

export function parseStudyStatistics(value: unknown): StudyStatistics {
  if (!isRecord(value) || !Array.isArray(value.subjects)) {
    throw new Error("STUDY_STATISTICS_DTO_INVALID");
  }
  const completionRatePercent = optionalSafeInteger(
    value.completionRatePercent,
  );
  const taskCount = value.taskCount;
  const completedTaskCount = value.completedTaskCount;
  const plannedMinutes = value.plannedMinutes;
  const actualMinutes = value.actualMinutes;
  const overdueTaskCount = value.overdueTaskCount;
  const integerFields = [
    taskCount,
    completedTaskCount,
    plannedMinutes,
    actualMinutes,
    overdueTaskCount,
  ];
  if (
    integerFields.some(
      (field) =>
        typeof field !== "number" || !Number.isSafeInteger(field) || field < 0,
    ) ||
    completionRatePercent === null ||
    (completionRatePercent !== undefined &&
      (completionRatePercent < 0 || completionRatePercent > 100)) ||
    typeof value.minuteDifference !== "number" ||
    !Number.isSafeInteger(value.minuteDifference)
  ) {
    throw new Error("STUDY_STATISTICS_DTO_INVALID");
  }
  if (
    typeof taskCount !== "number" ||
    typeof completedTaskCount !== "number" ||
    typeof plannedMinutes !== "number" ||
    typeof actualMinutes !== "number" ||
    typeof overdueTaskCount !== "number" ||
    (taskCount === 0) !== (completionRatePercent === undefined) ||
    completedTaskCount > taskCount
  ) {
    throw new Error("STUDY_STATISTICS_DTO_INVALID");
  }
  return {
    taskCount,
    completedTaskCount,
    ...(completionRatePercent === undefined ? {} : { completionRatePercent }),
    plannedMinutes,
    actualMinutes,
    minuteDifference: value.minuteDifference,
    overdueTaskCount,
    subjects: value.subjects.map(parseSubjectStatistics),
  };
}

export function parseTaskChangeSnapshot(value: unknown): TaskChangeSnapshot {
  if (!isRecord(value)) {
    throw new Error("TASK_CHANGE_SNAPSHOT_DTO_INVALID");
  }
  const subjectId = optionalString(value.subjectId);
  const description = optionalString(value.description);
  const estimatedMinutes = optionalSafeInteger(value.estimatedMinutes);
  const completedAt = optionalSafeInteger(value.completedAt);
  if (
    subjectId === null ||
    typeof value.title !== "string" ||
    value.title.length === 0 ||
    value.title.length > 120 ||
    description === null ||
    (description !== undefined && description.length > 2000) ||
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
    (value.status === "done") !== (completedAt !== undefined)
  ) {
    throw new Error("TASK_CHANGE_SNAPSHOT_DTO_INVALID");
  }
  return {
    ...(subjectId === undefined ? {} : { subjectId }),
    title: value.title,
    ...(description === undefined ? {} : { description }),
    plannedDate: value.plannedDate,
    ...(estimatedMinutes === undefined ? {} : { estimatedMinutes }),
    priority: value.priority as TaskPriority,
    status: value.status as TaskStatus,
    manualOrder: value.manualOrder,
    ...(completedAt === undefined ? {} : { completedAt }),
  };
}

export function parseStudyTaskChange(value: unknown): StudyTaskChange {
  if (!isRecord(value)) {
    throw new Error("TASK_CHANGE_DTO_INVALID");
  }
  const before =
    value.before === null || value.before === undefined
      ? undefined
      : parseTaskChangeSnapshot(value.before);
  const after =
    value.after === null || value.after === undefined
      ? undefined
      : parseTaskChangeSnapshot(value.after);
  const reason = optionalString(value.reason);
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.changeType !== "string" ||
    !CHANGE_TYPES.has(value.changeType as TaskChangeType) ||
    (before === undefined && after === undefined) ||
    reason === null ||
    (reason !== undefined && (reason.length === 0 || reason.length > 500)) ||
    (value.changeType === "rescheduled" && reason === undefined) ||
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0
  ) {
    throw new Error("TASK_CHANGE_DTO_INVALID");
  }
  return {
    id: value.id,
    changeType: value.changeType as TaskChangeType,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    ...(reason === undefined ? {} : { reason }),
    createdAt: value.createdAt,
  };
}

export function parseTaskChangeList(value: unknown): StudyTaskChange[] {
  if (!Array.isArray(value)) {
    throw new Error("TASK_CHANGE_LIST_DTO_INVALID");
  }
  return value.map(parseStudyTaskChange);
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

export async function listSubjects(): Promise<StudySubject[]> {
  const value: unknown = await invoke("list_subjects");
  return parseSubjectList(value);
}

export async function createSubject(
  request: CreateSubjectInput,
): Promise<StudySubject> {
  const value: unknown = await invoke("create_subject", { request });
  return parseStudySubject(value);
}

export async function archiveSubject(subjectId: string): Promise<StudySubject> {
  const value: unknown = await invoke("archive_subject", { subjectId });
  return parseStudySubject(value);
}

export async function renameSubject(
  subjectId: string,
  name: string,
): Promise<StudySubject> {
  const value: unknown = await invoke("rename_subject", {
    request: { subjectId, name },
  });
  return parseStudySubject(value);
}

export async function createTask(request: CreateTaskInput): Promise<StudyTask> {
  const value: unknown = await invoke("create_task", { request });
  return parseStudyTask(value);
}

export async function updateTaskDetails(
  taskId: string,
  request: UpdateTaskDetailsInput,
): Promise<StudyTask> {
  const value: unknown = await invoke("update_task_details", {
    taskId,
    request,
  });
  return parseStudyTask(value);
}

export async function rescheduleTask(
  taskId: string,
  request: RescheduleTaskInput,
): Promise<StudyTask> {
  const value: unknown = await invoke("reschedule_task", { taskId, request });
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

export async function listTaskChanges(
  taskId: string,
): Promise<StudyTaskChange[]> {
  const value: unknown = await invoke("list_task_changes", { taskId });
  return parseTaskChangeList(value);
}

export async function splitTask(
  taskId: string,
  request: SplitTaskInput,
): Promise<TaskSplitResult> {
  const value: unknown = await invoke("split_task", { taskId, request });
  return parseTaskSplitResult(value);
}

export async function trashTask(taskId: string): Promise<TrashedStudyTask> {
  const value: unknown = await invoke("trash_task", { taskId });
  return parseTrashedStudyTask(value);
}

export async function listTrashedTasks(): Promise<TrashedStudyTask[]> {
  const value: unknown = await invoke("list_trashed_tasks");
  return parseTrashedTaskList(value);
}

export async function restoreTrashedTask(taskId: string): Promise<StudyTask> {
  const value: unknown = await invoke("restore_trashed_task", { taskId });
  return parseStudyTask(value);
}

export async function listOverdueTasks(today: string): Promise<StudyTask[]> {
  const value: unknown = await invoke("list_overdue_tasks", { today });
  return parseTaskList(value);
}

export async function createStudySession(
  request: CreateStudySessionInput,
): Promise<StudySession> {
  const value: unknown = await invoke("create_study_session", { request });
  return parseStudySession(value);
}

export async function listStudySessions(
  startDate: string,
  endDate: string,
): Promise<StudySession[]> {
  const value: unknown = await invoke("list_study_sessions", {
    startDate,
    endDate,
  });
  return parseStudySessionList(value);
}

export async function getStudyStatistics(
  startDate: string,
  endDate: string,
  today: string,
): Promise<StudyStatistics> {
  const value: unknown = await invoke("get_study_statistics", {
    startDate,
    endDate,
    today,
  });
  return parseStudyStatistics(value);
}

export function normalizeScheduleCommandError(
  error: unknown,
): ScheduleCommandError {
  if (
    error instanceof Error &&
    (error.message === "TASK_DTO_INVALID" ||
      error.message === "TASK_LIST_DTO_INVALID" ||
      error.message === "SUBJECT_DTO_INVALID" ||
      error.message === "SUBJECT_LIST_DTO_INVALID" ||
      error.message === "TASK_CHANGE_SNAPSHOT_DTO_INVALID" ||
      error.message === "TASK_CHANGE_DTO_INVALID" ||
      error.message === "TASK_CHANGE_LIST_DTO_INVALID" ||
      error.message === "TRASHED_TASK_DTO_INVALID" ||
      error.message === "TRASHED_TASK_LIST_DTO_INVALID" ||
      error.message === "TASK_SPLIT_DTO_INVALID" ||
      error.message === "STUDY_SESSION_DTO_INVALID" ||
      error.message === "STUDY_SESSION_LIST_DTO_INVALID" ||
      error.message === "STUDY_STATISTICS_DTO_INVALID" ||
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
