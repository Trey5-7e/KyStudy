import type { CyclePlanOverview } from "../../shared/tauri/cyclePlanClient";

export type CyclePlanWindowMode = "summary" | "edit" | "archive";

export function cyclePlanVisibilityLabel(calendarVisible: boolean): string {
  return calendarVisible ? "从月历隐藏" : "显示在月历";
}

export function cyclePlanVisibilityStatus(calendarVisible: boolean): string {
  return calendarVisible ? "已显示在月历" : "已从月历隐藏";
}

export function cyclePlanProgressLabel(overview: CyclePlanOverview): string {
  return `已完成 ${overview.completedCount} / ${overview.plan.totalUnits} ${overview.plan.unitLabel}`;
}
