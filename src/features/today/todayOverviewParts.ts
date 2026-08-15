import type {
  CyclePlanDashboard,
  CyclePlanItem,
  CyclePlanOverview,
} from "../../shared/tauri/cyclePlanClient";
import type { ReviewSchemeDashboard } from "../../shared/tauri/reviewSchemeClient";
import {
  cyclePlanItemActions,
  type CyclePlanItemAction,
} from "../planning/cyclePlanItemActions";

/** A cycle-plan item together with the plan metadata needed by Today. */
export interface TodayCycleItem {
  item: CyclePlanItem;
  overview: CyclePlanOverview;
}

export interface TodayCycleSummary {
  items: TodayCycleItem[];
  completedCount: number;
  skippedCount: number;
  pendingItems: TodayCycleItem[];
}

export function getTodayCycleItems(
  dashboard: CyclePlanDashboard | undefined,
  date: string,
): TodayCycleItem[] {
  const items =
    dashboard?.plans.flatMap((overview) =>
      overview.plan.calendarVisible
        ? overview.items
            .filter(
              (item) =>
                item.plannedStartDate <= date && item.plannedEndDate >= date,
            )
            .map((item) => ({ item, overview }))
        : [],
    ) ?? [];

  // The dashboard is grouped by plan, not guaranteed to be chronological.
  // Today’s primary action must always point at the earliest pending item.
  return [...items].sort((left, right) => {
    const startDateOrder = left.item.plannedStartDate.localeCompare(
      right.item.plannedStartDate,
    );
    if (startDateOrder !== 0) return startDateOrder;

    const endDateOrder = left.item.plannedEndDate.localeCompare(
      right.item.plannedEndDate,
    );
    if (endDateOrder !== 0) return endDateOrder;

    const unitOrder = left.item.unitIndex - right.item.unitIndex;
    if (unitOrder !== 0) return unitOrder;

    return left.item.id.localeCompare(right.item.id);
  });
}

export function summarizeTodayCycleItems(
  items: TodayCycleItem[],
): TodayCycleSummary {
  const completedCount = items.filter(
    ({ item }) => item.state === "completed",
  ).length;
  const skippedCount = items.filter(
    ({ item }) => item.state === "skipped",
  ).length;
  return {
    items,
    completedCount,
    skippedCount,
    pendingItems: items.filter(({ item }) => item.state === "pending"),
  };
}

type ReviewScheme = ReviewSchemeDashboard["schemes"][number];

export interface TodayReviewSummary {
  activeSchemes: ReviewScheme[];
  completed: number;
  target: number;
  generated: number;
  remaining: number;
  finished: boolean;
  restDay: boolean;
  tone: "neutral" | "success" | "warning";
}

export function summarizeTodayReview(
  review: ReviewSchemeDashboard | undefined,
): TodayReviewSummary {
  const activeSchemes =
    review?.schemes.filter((item) => item.scheme.enabled) ?? [];
  const completed = activeSchemes.reduce(
    (total, item) => total + (item.queue?.completedCount ?? 0),
    0,
  );
  const target = activeSchemes.reduce(
    (total, item) =>
      total +
      (item.queue?.items.length ??
        Math.min(item.dueCount, item.scheme.dailyQuota)),
    0,
  );
  const generated = activeSchemes.filter(
    (item) => item.queue !== undefined,
  ).length;
  const finished =
    activeSchemes.length > 0 &&
    activeSchemes.every(
      (item) =>
        item.isRestDay ||
        (item.queue !== undefined &&
          item.queue.completedCount >= item.queue.items.length),
    );
  const restDay =
    activeSchemes.length > 0 && activeSchemes.every((item) => item.isRestDay);
  const remaining = Math.max(0, target - completed);
  const tone = restDay
    ? "neutral"
    : finished
      ? "success"
      : remaining > 0 && review !== undefined
        ? "warning"
        : "neutral";
  return {
    activeSchemes,
    completed,
    target,
    generated,
    remaining,
    finished,
    restDay,
    tone,
  };
}

export interface TodayProgressSummary {
  total: number;
  completed: number;
  percent: number;
}

export function summarizeTodayProgress(
  totalPlanItems: number,
  completedPlanItems: number,
  reviewTarget: number,
  reviewCompleted: number,
): TodayProgressSummary {
  const total = totalPlanItems + reviewTarget;
  const completed = completedPlanItems + reviewCompleted;
  return {
    total,
    completed,
    percent:
      total === 0 ? 0 : Math.min(100, Math.round((completed / total) * 100)),
  };
}

export type TodayNextActionKind = "review" | "cycle" | "plan" | "workbook";

export interface TodayOverviewSummary {
  cycle: TodayCycleSummary;
  review: TodayReviewSummary;
  nextCycle?: TodayCycleItem;
  nextCycleAction?: CyclePlanItemAction;
  nextCycleLabel?: string;
  reviewHasWork: boolean;
  nextActionKind: TodayNextActionKind;
  progress: TodayProgressSummary;
}

export function summarizeTodayOverview(
  dashboard: CyclePlanDashboard | undefined,
  date: string,
  review: ReviewSchemeDashboard | undefined,
  hasActivePlan: boolean,
): TodayOverviewSummary {
  const cycle = summarizeTodayCycleItems(getTodayCycleItems(dashboard, date));
  const reviewSummary = summarizeTodayReview(review);
  const nextCycle = cycle.pendingItems[0];
  const reviewHasWork =
    reviewSummary.remaining > 0 &&
    !reviewSummary.restDay &&
    review !== undefined;
  const nextActionKind = reviewHasWork
    ? "review"
    : nextCycle !== undefined
      ? "cycle"
      : hasActivePlan
        ? "plan"
        : "workbook";
  return {
    cycle,
    review: reviewSummary,
    nextCycle,
    nextCycleAction:
      nextCycle === undefined
        ? undefined
        : cyclePlanItemActions(nextCycle.item.state)[0],
    nextCycleLabel:
      nextCycle === undefined
        ? undefined
        : `${nextCycle.overview.plan.name}第 ${nextCycle.item.unitIndex} ${nextCycle.overview.plan.unitLabel}`,
    reviewHasWork,
    nextActionKind,
    progress: summarizeTodayProgress(
      cycle.items.length,
      cycle.completedCount,
      reviewSummary.target,
      reviewSummary.completed,
    ),
  };
}
