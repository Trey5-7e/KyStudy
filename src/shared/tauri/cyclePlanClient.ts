import { invoke } from "@tauri-apps/api/core";

export type CycleScheduleMode = "rhythm" | "even";
export type CyclePlanItemState = "pending" | "completed" | "skipped";

export interface CyclePlan {
  id: string;
  name: string;
  totalUnits: number;
  unitLabel: string;
  startDate: string;
  deadline: string;
  studyDaysPerUnit: number;
  scheduleMode: CycleScheduleMode;
  calendarVisible: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CyclePlanItem {
  id: string;
  planId: string;
  unitIndex: number;
  plannedStartDate: string;
  plannedEndDate: string;
  originalStartDate: string;
  originalEndDate: string;
  state: CyclePlanItemState;
  completedAt?: number;
  skippedAt?: number;
  shiftCount: number;
  updatedAt: number;
}

export interface CyclePlanOverview {
  plan: CyclePlan;
  items: CyclePlanItem[];
  completedCount: number;
  skippedCount: number;
  progressPercent: number;
  estimatedEndDate: string;
  exceedsDeadline: boolean;
  recommendedStudyDaysPerUnit?: number;
  recommendedTotalUnits?: number;
}

export interface CyclePlanDashboard {
  restWeekdays: number[];
  plans: CyclePlanOverview[];
}

export interface CyclePlanItemStateMutation {
  dashboard: CyclePlanDashboard;
  itemId: string;
  itemUpdatedAt: number;
}

export interface CyclePlanShiftUndo {
  planId: string;
  undoToken: string;
  expiresAt: number;
}

export interface CyclePlanShiftMutation {
  dashboard: CyclePlanDashboard;
  shiftedItemCount: number;
  undo: CyclePlanShiftUndo | null;
}

export interface CyclePlanShiftPreview {
  planId: string;
  fromDate: string;
  studyDays: number;
  affectedItemCount: number;
  currentEstimatedEndDate: string;
  newEstimatedEndDate: string;
  deadline: string;
  exceedsDeadlineByDays: number;
  restWeekdays: number[];
  previewToken: string | null;
}

export interface SaveCyclePlanInput {
  planId?: string;
  expectedUpdatedAt?: number;
  name: string;
  totalUnits: number;
  unitLabel: string;
  startDate: string;
  deadline: string;
  studyDaysPerUnit: number;
  scheduleMode: CycleScheduleMode;
  calendarVisible: boolean;
}

export interface SetCyclePlanItemStateRequest {
  itemId: string;
  targetState: CyclePlanItemState;
  expectedUpdatedAt: number;
}

export interface RestoreCyclePlanItemStateRequest {
  itemId: string;
  state: CyclePlanItemState;
  completedAt?: number;
  skippedAt?: number;
  expectedUpdatedAt: number;
}

export interface PreviewCyclePlanShiftRequest {
  planId: string;
  fromDate: string;
  studyDays: number;
}

export interface ConfirmCyclePlanShiftRequest extends PreviewCyclePlanShiftRequest {
  previewToken: string;
}

export interface UndoCyclePlanShiftRequest {
  planId: string;
  undoToken: string;
}

export interface CyclePlanCommandError {
  code: string;
  message: string;
  action: string;
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ERROR_COPY: Record<string, Omit<CyclePlanCommandError, "code">> = {
  WORKSPACE_NOT_INITIALIZED: {
    message: "尚未创建本地工作区。",
    action: "先创建本地工作区，再添加周期计划。",
  },
  CYCLE_PLAN_NOT_FOUND: {
    message: "找不到这份周期计划。",
    action: "刷新计划页后重新选择。",
  },
  CYCLE_PLAN_ITEM_NOT_FOUND: {
    message: "找不到这个计划事项。",
    action: "刷新月历后重新操作。",
  },
  CYCLE_PLAN_INPUT_INVALID: {
    message: "周期计划的数量、日期或节奏无效。",
    action: "检查开始日、截止日、总量和每个单位所需学习日。",
  },
  CYCLE_PLAN_COMPLETED_CONFLICT: {
    message: "已有完成或跳过事项的序号超出新的总量。",
    action: "请增大总量，保留所有完成或跳过事项后再保存。",
  },
  CYCLE_PLAN_SAVE_STALE: {
    message: "周期计划已在其他窗口发生变化。",
    action: "刷新计划并重新核对编辑内容后再保存。",
  },
  CYCLE_PLAN_ITEM_STATE_STALE: {
    message: "计划事项的状态已发生变化。",
    action: "刷新周期计划后重试，避免覆盖最新状态。",
  },
  CYCLE_PLAN_SHIFT_UNDO_UNAVAILABLE: {
    message: "没有可撤销的周期计划顺延。",
    action: "该顺延已失效或已被新的操作替换，请刷新计划后重试。",
  },
  CYCLE_PLAN_SHIFT_UNDO_STALE: {
    message: "周期计划顺延后的事项已发生变化。",
    action: "刷新周期计划后重试，避免覆盖最新安排。",
  },
  CYCLE_PLAN_SHIFT_PREVIEW_STALE: {
    message: "顺延预览已与当前计划不一致。",
    action: "刷新预览并确认最新排程后重试。",
  },
  DATABASE_BUSY: {
    message: "本地数据库正在被占用。",
    action: "关闭其他 KyStudy 窗口后重试。",
  },
};

export async function getCyclePlanDashboard(): Promise<CyclePlanDashboard> {
  return parseDashboard(await invoke("get_cycle_plan_dashboard"));
}

export async function saveCyclePlan(
  request: SaveCyclePlanInput,
): Promise<CyclePlanDashboard> {
  return parseDashboard(await invoke("save_cycle_plan", { request }));
}

export async function setCyclePlanItemState(
  request: SetCyclePlanItemStateRequest,
): Promise<CyclePlanItemStateMutation> {
  return parseCyclePlanItemStateMutation(
    await invoke("set_cycle_plan_item_state", { request }),
  );
}

export async function restoreCyclePlanItemState(
  request: RestoreCyclePlanItemStateRequest,
): Promise<CyclePlanDashboard> {
  return parseDashboard(
    await invoke("restore_cycle_plan_item_state", { request }),
  );
}

export async function previewCyclePlanShift(
  request: PreviewCyclePlanShiftRequest,
): Promise<CyclePlanShiftPreview> {
  return parseCyclePlanShiftPreview(
    await invoke("preview_cycle_plan_shift", { request }),
  );
}

export async function confirmCyclePlanShift(
  request: ConfirmCyclePlanShiftRequest,
): Promise<CyclePlanShiftMutation> {
  return parseCyclePlanShiftMutation(
    await invoke("confirm_cycle_plan_shift", { request }),
  );
}

export async function undoCyclePlanShift(
  request: UndoCyclePlanShiftRequest,
): Promise<CyclePlanDashboard> {
  return parseDashboard(await invoke("undo_shift_cycle_plan", { request }));
}

export async function archiveCyclePlan(
  planId: string,
  expectedUpdatedAt: number,
): Promise<CyclePlanDashboard> {
  return parseDashboard(
    await invoke("archive_cycle_plan", { planId, expectedUpdatedAt }),
  );
}

export async function refreshCyclePlanSchedules(): Promise<CyclePlanDashboard> {
  return parseDashboard(await invoke("refresh_cycle_plan_schedules"));
}

export function normalizeCyclePlanError(error: unknown): CyclePlanCommandError {
  if (isRecord(error) && typeof error.code === "string") {
    const copy = ERROR_COPY[error.code];
    if (copy !== undefined) {
      return { code: error.code, ...copy };
    }
  }
  return {
    code: "CYCLE_PLAN_UNAVAILABLE",
    message: "本地周期计划暂时不可用。",
    action: "重新启动应用后重试。",
  };
}

export function parseDashboard(value: unknown): CyclePlanDashboard {
  if (
    !isRecord(value) ||
    !Array.isArray(value.restWeekdays) ||
    !Array.isArray(value.plans)
  ) {
    throw new Error("CYCLE_PLAN_DASHBOARD_INVALID");
  }
  const restWeekdays = value.restWeekdays.map((value) => {
    if (!integer(value, 0, 6)) {
      throw new Error("CYCLE_PLAN_DASHBOARD_INVALID");
    }
    return value;
  });
  return { restWeekdays, plans: value.plans.map(parseOverview) };
}

export function parseCyclePlanItemStateMutation(
  value: unknown,
): CyclePlanItemStateMutation {
  if (
    !isRecord(value) ||
    typeof value.itemId !== "string" ||
    value.itemId.length === 0 ||
    !integer(value.itemUpdatedAt, 0)
  ) {
    throw new Error("CYCLE_PLAN_ITEM_STATE_MUTATION_INVALID");
  }
  return {
    dashboard: parseDashboard(value.dashboard),
    itemId: value.itemId,
    itemUpdatedAt: value.itemUpdatedAt,
  };
}

export function parseCyclePlanShiftMutation(
  value: unknown,
): CyclePlanShiftMutation {
  if (
    !isRecord(value) ||
    !integer(value.shiftedItemCount, 0) ||
    !("undo" in value) ||
    (value.undo !== null && !isRecord(value.undo)) ||
    (value.shiftedItemCount === 0) !== (value.undo === null)
  ) {
    throw new Error("CYCLE_PLAN_SHIFT_MUTATION_INVALID");
  }
  return {
    dashboard: parseDashboard(value.dashboard),
    shiftedItemCount: value.shiftedItemCount,
    undo: value.undo === null ? null : parseCyclePlanShiftUndo(value.undo),
  };
}

export function parseCyclePlanShiftPreview(
  value: unknown,
): CyclePlanShiftPreview {
  if (
    !isRecord(value) ||
    typeof value.planId !== "string" ||
    value.planId.length === 0 ||
    !date(value.fromDate) ||
    !integer(value.studyDays, 1) ||
    !integer(value.affectedItemCount, 0) ||
    !date(value.currentEstimatedEndDate) ||
    !date(value.newEstimatedEndDate) ||
    !date(value.deadline) ||
    !integer(value.exceedsDeadlineByDays, 0) ||
    !Array.isArray(value.restWeekdays) ||
    (value.previewToken !== null &&
      (typeof value.previewToken !== "string" ||
        value.previewToken.trim().length === 0))
  ) {
    throw new Error("CYCLE_PLAN_SHIFT_PREVIEW_INVALID");
  }
  const restWeekdays = value.restWeekdays.map((weekday) => {
    if (!integer(weekday, 0, 6)) {
      throw new Error("CYCLE_PLAN_SHIFT_PREVIEW_INVALID");
    }
    return weekday;
  });
  if (
    new Set(restWeekdays).size !== restWeekdays.length ||
    (value.affectedItemCount === 0) !== (value.previewToken === null)
  ) {
    throw new Error("CYCLE_PLAN_SHIFT_PREVIEW_INVALID");
  }
  return {
    planId: value.planId,
    fromDate: value.fromDate,
    studyDays: value.studyDays,
    affectedItemCount: value.affectedItemCount,
    currentEstimatedEndDate: value.currentEstimatedEndDate,
    newEstimatedEndDate: value.newEstimatedEndDate,
    deadline: value.deadline,
    exceedsDeadlineByDays: value.exceedsDeadlineByDays,
    restWeekdays,
    previewToken: value.previewToken,
  };
}

function parseCyclePlanShiftUndo(
  value: Record<string, unknown>,
): CyclePlanShiftUndo {
  if (
    typeof value.planId !== "string" ||
    value.planId.length === 0 ||
    typeof value.undoToken !== "string" ||
    value.undoToken.trim().length === 0 ||
    !integer(value.expiresAt, 0)
  ) {
    throw new Error("CYCLE_PLAN_SHIFT_UNDO_INVALID");
  }
  return {
    planId: value.planId,
    undoToken: value.undoToken,
    expiresAt: value.expiresAt,
  };
}

function parseOverview(value: unknown): CyclePlanOverview {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !integer(value.completedCount, 0) ||
    !integer(value.skippedCount, 0) ||
    !integer(value.progressPercent, 0, 100) ||
    !date(value.estimatedEndDate) ||
    typeof value.exceedsDeadline !== "boolean" ||
    !optionalPositiveInteger(value.recommendedStudyDaysPerUnit) ||
    !optionalPositiveInteger(value.recommendedTotalUnits)
  ) {
    throw new Error("CYCLE_PLAN_OVERVIEW_INVALID");
  }
  const plan = parsePlan(value.plan);
  if (value.completedCount + value.skippedCount > plan.totalUnits) {
    throw new Error("CYCLE_PLAN_OVERVIEW_INVALID");
  }
  return {
    plan,
    items: value.items.map(parseItem),
    completedCount: value.completedCount,
    skippedCount: value.skippedCount,
    progressPercent: value.progressPercent,
    estimatedEndDate: value.estimatedEndDate,
    exceedsDeadline: value.exceedsDeadline,
    recommendedStudyDaysPerUnit:
      typeof value.recommendedStudyDaysPerUnit === "number"
        ? value.recommendedStudyDaysPerUnit
        : undefined,
    recommendedTotalUnits:
      typeof value.recommendedTotalUnits === "number"
        ? value.recommendedTotalUnits
        : undefined,
  };
}

function parsePlan(value: unknown): CyclePlan {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !integer(value.totalUnits, 1, 500) ||
    typeof value.unitLabel !== "string" ||
    !date(value.startDate) ||
    !date(value.deadline) ||
    !integer(value.studyDaysPerUnit, 1, 30) ||
    (value.scheduleMode !== "rhythm" && value.scheduleMode !== "even") ||
    typeof value.calendarVisible !== "boolean" ||
    !integer(value.createdAt, 0) ||
    !integer(value.updatedAt, 0)
  ) {
    throw new Error("CYCLE_PLAN_INVALID");
  }
  return value as unknown as CyclePlan;
}

function parseItem(value: unknown): CyclePlanItem {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.planId !== "string" ||
    !integer(value.unitIndex, 1) ||
    !date(value.plannedStartDate) ||
    !date(value.plannedEndDate) ||
    !date(value.originalStartDate) ||
    !date(value.originalEndDate) ||
    (value.state !== "pending" &&
      value.state !== "completed" &&
      value.state !== "skipped") ||
    !optionalNonnegativeInteger(value.completedAt) ||
    !optionalNonnegativeInteger(value.skippedAt) ||
    (value.state === "completed") !== (typeof value.completedAt === "number") ||
    (value.state === "skipped") !== (typeof value.skippedAt === "number") ||
    !integer(value.shiftCount, 0) ||
    !integer(value.updatedAt, 0)
  ) {
    throw new Error("CYCLE_PLAN_ITEM_INVALID");
  }
  return {
    ...(value as unknown as CyclePlanItem),
    completedAt:
      typeof value.completedAt === "number" ? value.completedAt : undefined,
    skippedAt:
      typeof value.skippedAt === "number" ? value.skippedAt : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function date(value: unknown): value is string {
  return typeof value === "string" && LOCAL_DATE.test(value);
}

function integer(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function optionalPositiveInteger(value: unknown): boolean {
  return value === null || value === undefined || integer(value, 1);
}

function optionalNonnegativeInteger(value: unknown): boolean {
  return value === null || value === undefined || integer(value, 0);
}
