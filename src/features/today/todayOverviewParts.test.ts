import { describe, expect, it } from "vitest";

import type {
  CyclePlanDashboard,
  CyclePlanItem,
  CyclePlanOverview,
} from "../../shared/tauri/cyclePlanClient";
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
});
