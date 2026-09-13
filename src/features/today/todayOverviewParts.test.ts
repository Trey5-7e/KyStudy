import { describe, expect, it } from "vitest";

import type {
  CyclePlanDashboard,
  CyclePlanItem,
  CyclePlanOverview,
} from "../../shared/tauri/cyclePlanClient";
import type { ReviewSchemeDashboard } from "../../shared/tauri/reviewSchemeClient";
import { summarizeTodayOverview } from "./todayOverviewParts";

function item(overrides: Partial<CyclePlanItem>): CyclePlanItem {
  return {
    id: "item-default",
    planId: "plan-default",
    unitIndex: 1,
    plannedStartDate: "2026-08-10",
    plannedEndDate: "2026-08-12",
    originalStartDate: "2026-08-10",
    originalEndDate: "2026-08-12",
    state: "pending",
    shiftCount: 0,
    updatedAt: 1,
    ...overrides,
  };
}

function overview(
  id: string,
  name: string,
  items: CyclePlanItem[],
): CyclePlanOverview {
  return {
    plan: {
      id,
      name,
      totalUnits: Math.max(1, items.length),
      unitLabel: "章",
      startDate: "2026-08-01",
      deadline: "2026-08-31",
      studyDaysPerUnit: 1,
      scheduleMode: "even",
      calendarVisible: true,
      createdAt: 1,
      updatedAt: 1,
    },
    items,
    completedCount: 0,
    skippedCount: 0,
    progressPercent: 0,
    estimatedEndDate: "2026-08-31",
    exceedsDeadline: false,
  };
}

describe("today cycle ordering", () => {
  it("chooses the earliest visible pending item as the next action", () => {
    const dashboard: CyclePlanDashboard = {
      restWeekdays: [],
      plans: [
        overview("late-plan", "晚间计划", [
          item({
            id: "late-item",
            planId: "late-plan",
            unitIndex: 2,
            plannedStartDate: "2026-08-11",
            plannedEndDate: "2026-08-12",
          }),
        ]),
        overview("early-plan", "早间计划", [
          item({
            id: "early-item",
            planId: "early-plan",
            unitIndex: 1,
            plannedStartDate: "2026-08-10",
            plannedEndDate: "2026-08-11",
          }),
        ]),
      ],
    };

    const summary = summarizeTodayOverview(
      dashboard,
      "2026-08-11",
      undefined,
      true,
    );

    expect(
      summary.cycle.items.map(({ item: cycleItem }) => cycleItem.id),
    ).toEqual(["early-item", "late-item"]);
    expect(summary.nextCycle?.item.id).toBe("early-item");
  });

  it("orders overlapping items by start date before selecting the action", () => {
    const dashboard: CyclePlanDashboard = {
      restWeekdays: [],
      plans: [
        overview("plan", "计划", [
          item({
            id: "later-start",
            planId: "plan",
            unitIndex: 2,
            plannedStartDate: "2026-08-11",
            plannedEndDate: "2026-08-12",
          }),
          item({
            id: "earlier-start",
            planId: "plan",
            unitIndex: 1,
            plannedStartDate: "2026-08-10",
            plannedEndDate: "2026-08-12",
          }),
        ]),
      ],
    };

    const summary = summarizeTodayOverview(
      dashboard,
      "2026-08-11",
      undefined,
      true,
    );

    expect(
      summary.cycle.items.map(({ item: cycleItem }) => cycleItem.id),
    ).toEqual(["earlier-start", "later-start"]);
    expect(summary.nextCycle?.item.id).toBe("earlier-start");
  });

  it("keeps due count as target if queue is empty or undefined and avoids premature finished state", () => {
    const dashboardWithDueOnly: ReviewSchemeDashboard = {
      restWeekdays: [],
      schemes: [
        {
          scheme: {
            id: "scheme-1",
            name: "英语",
            subjectId: "sub-1",
            subjectName: "英语",
            allSubjectWorkbooks: true,
            dailyQuota: 10,
            enabled: true,
            documentIds: [],
            typeQuotas: [],
            createdAt: 1,
            updatedAt: 1,
          },
          isRestDay: false,
          dueCount: 5,
          pendingClassificationCount: 0,
          queue: undefined,
        },
      ],
    };

    const initialSummary = summarizeTodayOverview(
      undefined,
      "2026-08-11",
      dashboardWithDueOnly,
      false,
    );
    expect(initialSummary.review.target).toBe(5);
    expect(initialSummary.review.remaining).toBe(5);
    expect(initialSummary.review.finished).toBe(false);
    expect(initialSummary.reviewHasWork).toBe(true);

    // If an empty queue anomaly happens (items.length = 0)
    const dashboardWithEmptyQueue: ReviewSchemeDashboard = {
      restWeekdays: [],
      schemes: [
        {
          ...dashboardWithDueOnly.schemes[0]!,
          queue: {
            id: "queue-1",
            schemeId: "scheme-1",
            queueDate: "2026-08-11",
            quota: 10,
            generatedAt: 1,
            completedCount: 0,
            items: [],
          },
        },
      ],
    };

    const anomalySummary = summarizeTodayOverview(
      undefined,
      "2026-08-11",
      dashboardWithEmptyQueue,
      false,
    );
    expect(anomalySummary.review.target).toBe(5);
    expect(anomalySummary.review.remaining).toBe(5);
    expect(anomalySummary.review.finished).toBe(false);
    expect(anomalySummary.reviewHasWork).toBe(true);
  });
});
