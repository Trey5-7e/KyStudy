import type { CyclePlanItemState } from "../../shared/tauri/cyclePlanClient";

export interface CyclePlanItemAction {
  label: string;
  targetState: CyclePlanItemState;
}

const PENDING_ACTIONS: readonly CyclePlanItemAction[] = [
  { label: "完成", targetState: "completed" },
  { label: "跳过本次", targetState: "skipped" },
];
const COMPLETED_ACTIONS: readonly CyclePlanItemAction[] = [
  { label: "恢复未完成", targetState: "pending" },
];
const SKIPPED_ACTIONS: readonly CyclePlanItemAction[] = [
  { label: "恢复待办", targetState: "pending" },
];

export function cyclePlanItemActions(
  state: CyclePlanItemState,
): readonly CyclePlanItemAction[] {
  if (state === "pending") return PENDING_ACTIONS;
  if (state === "completed") return COMPLETED_ACTIONS;
  return SKIPPED_ACTIONS;
}

export function cyclePlanItemStateLabel(state: CyclePlanItemState): string {
  if (state === "completed") return "已完成";
  if (state === "skipped") return "已跳过";
  return "待完成";
}

export function cyclePlanItemTransitionNotice(
  previousState: CyclePlanItemState,
  targetState: CyclePlanItemState,
): string {
  if (targetState === "completed") return "周期事项已完成。";
  if (targetState === "skipped") return "已跳过本次周期事项。";
  return previousState === "completed" ? "已恢复为未完成。" : "已恢复为待办。";
}
