import { itemOccursOn, localDate, monthCells } from "./cycleCalendar";
import {
  cyclePlanUndoIdentity,
  isCyclePlanUndoExpired,
  type CyclePlanUndoAction,
} from "./cyclePlanUndo";
import type {
  CyclePlanCommandError,
  CyclePlanItem,
  CyclePlanOverview,
  CyclePlanShiftPreview,
  CycleScheduleMode,
  PreviewCyclePlanShiftRequest,
} from "../../shared/tauri/cyclePlanClient";
import {
  cyclePlanShiftUndoIdentity,
  isCyclePlanShiftUndoExpired,
  type CyclePlanShiftUndoAction,
} from "./cyclePlanShiftUndo";
import type { CyclePlanWindowMode } from "./cyclePlanWindowModel";

export const WEEKDAYS = [
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
  "周日",
];
export const NEW_PLAN_ID = "__new_cycle_plan__";

export interface CyclePlanDraft {
  planId?: string;
  expectedUpdatedAt?: number;
  name: string;
  totalUnits: string;
  unitLabel: string;
  startDate: string;
  deadline: string;
  studyDaysPerUnit: string;
  scheduleMode: CycleScheduleMode;
  calendarVisible: boolean;
}

export interface CyclePlanItemUndoState {
  kind: "item";
  action: CyclePlanUndoAction;
  itemLabel: string;
}

export interface CyclePlanShiftUndoState {
  kind: "shift";
  action: CyclePlanShiftUndoAction;
  itemLabel: string;
}

export type CyclePlanUndoState =
  CyclePlanItemUndoState | CyclePlanShiftUndoState;

export type CyclePlanPanelWindowMode = CyclePlanWindowMode | "shift-preview";

export type CyclePlanShiftPreviewState =
  | {
      status: "loading";
      request: PreviewCyclePlanShiftRequest;
      preview?: CyclePlanShiftPreview;
    }
  | {
      status: "ready" | "empty" | "confirming";
      request: PreviewCyclePlanShiftRequest;
      preview: CyclePlanShiftPreview;
    }
  | {
      status: "stale" | "error";
      request: PreviewCyclePlanShiftRequest;
      preview?: CyclePlanShiftPreview;
      error: CyclePlanCommandError;
    };

export function emptyDraft(): CyclePlanDraft {
  const start = new Date();
  const deadline = new Date(
    start.getFullYear(),
    start.getMonth() + 1,
    start.getDate(),
    12,
  );
  return {
    name: "",
    totalUnits: "20",
    unitLabel: "套",
    startDate: localDate(start),
    deadline: localDate(deadline),
    studyDaysPerUnit: "2",
    scheduleMode: "rhythm",
    calendarVisible: true,
  };
}

export function toInput(draft: CyclePlanDraft) {
  return {
    planId: draft.planId,
    ...(draft.planId === undefined
      ? {}
      : { expectedUpdatedAt: draft.expectedUpdatedAt }),
    name: draft.name,
    totalUnits: Number(draft.totalUnits),
    unitLabel: draft.unitLabel,
    startDate: draft.startDate,
    deadline: draft.deadline,
    studyDaysPerUnit: Number(draft.studyDaysPerUnit),
    scheduleMode: draft.scheduleMode,
    calendarVisible: draft.calendarVisible,
  };
}

export function fromOverview(overview: CyclePlanOverview): CyclePlanDraft {
  const plan = overview.plan;
  return {
    planId: plan.id,
    expectedUpdatedAt: plan.updatedAt,
    name: plan.name,
    totalUnits: String(plan.totalUnits),
    unitLabel: plan.unitLabel,
    startDate: plan.startDate,
    deadline: plan.deadline,
    studyDaysPerUnit: String(plan.studyDaysPerUnit),
    scheduleMode: plan.scheduleMode,
    calendarVisible: plan.calendarVisible,
  };
}

export function sameDraft(
  left: CyclePlanDraft,
  right: CyclePlanDraft,
): boolean {
  return (
    JSON.stringify({ ...left, expectedUpdatedAt: undefined }) ===
    JSON.stringify({ ...right, expectedUpdatedAt: undefined })
  );
}

export function eventsForDate(
  plans: CyclePlanOverview[],
  date: string,
): Array<{ overview: CyclePlanOverview; item: CyclePlanItem }> {
  return plans.flatMap((overview) =>
    overview.plan.calendarVisible
      ? overview.items
          .filter((item) => itemOccursOn(date, item))
          .map((item) => ({ overview, item }))
      : [],
  );
}

export function changeMonth(
  value: { year: number; month: number },
  offset: number,
): { year: number; month: number } {
  const date = new Date(value.year, value.month + offset, 1, 12);
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function formatMonth(year: number, month: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
  }).format(new Date(year, month, 1, 12));
}

export function formatFullDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12));
}

export function formatShortDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12));
}

export function previewFromState(
  state: CyclePlanShiftPreviewState,
): CyclePlanShiftPreview | undefined {
  return state.preview;
}

export function undoIdentityFor(action: CyclePlanUndoState): string {
  return action.kind === "item"
    ? cyclePlanUndoIdentity(action.action)
    : cyclePlanShiftUndoIdentity(action.action);
}

export function isCyclePlanUndoExpiredFor(action: CyclePlanUndoState): boolean {
  return action.kind === "item"
    ? isCyclePlanUndoExpired(action.action)
    : isCyclePlanShiftUndoExpired(action.action);
}

export { monthCells };
