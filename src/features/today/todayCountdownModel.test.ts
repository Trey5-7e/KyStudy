import { describe, expect, it } from "vitest";

import type { StudyPlan } from "../../shared/tauri/planningClient";
import { mergeOverviewResults } from "./TodayOverviewPanel";
import { daysUntilExam, selectUpcomingExam } from "./todayCountdownModel";

function plan(overrides: Partial<StudyPlan>): StudyPlan {
  return {
    id: "plan-1",
    title: "备考计划",
    status: "active",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("selectUpcomingExam", () => {
  it("selects the nearest active exam and ignores invalid dates", () => {
    const selected = selectUpcomingExam(
      [
        plan({ id: "far", targetExam: "远期考试", examDate: "2026-08-30" }),
        plan({ id: "invalid", examDate: "2026-02-30" }),
        plan({ id: "near", targetExam: "最近考试", examDate: "2026-08-12" }),
      ],
      "2026-08-10",
    );

    expect(selected).toEqual({
      planId: "near",
      examName: "最近考试",
      examDate: "2026-08-12",
      daysRemaining: 2,
      isToday: false,
    });
  });

  it("excludes expired and non-active plans", () => {
    const selected = selectUpcomingExam(
      [
        plan({ id: "expired", examDate: "2026-08-09" }),
        plan({ id: "draft", status: "draft", examDate: "2026-08-11" }),
        plan({ id: "archived", status: "archived", examDate: "2026-08-12" }),
      ],
      "2026-08-10",
    );

    expect(selected).toBeUndefined();
  });

  it("marks an exam on today's date as same-day with zero days remaining", () => {
    const selected = selectUpcomingExam(
      [plan({ targetExam: "今日考试", examDate: "2026-08-10" })],
      "2026-08-10",
    );

    expect(selected?.daysRemaining).toBe(0);
    expect(selected?.isToday).toBe(true);
  });
});

describe("daysUntilExam", () => {
  it("returns signed date distance and rejects malformed dates", () => {
    expect(daysUntilExam("2026-08-10", "2026-08-13")).toBe(3);
    expect(daysUntilExam("2026-08-10", "2026-08-09")).toBe(-1);
    expect(daysUntilExam("2026-08-10", "2026-08-32")).toBeUndefined();
  });
});

describe("mergeOverviewResults", () => {
  it("keeps core data when the plans request is rejected", () => {
    const review = { restWeekdays: [], schemes: [] };
    const cyclePlans = { restWeekdays: [], plans: [] };
    const overview = mergeOverviewResults("2026-08-10", [
      { status: "fulfilled", value: review },
      { status: "fulfilled", value: cyclePlans },
      { status: "rejected", reason: { code: "PLAN_NOT_FOUND" } },
    ]);

    expect(overview.date).toBe("2026-08-10");
    expect(overview.review).toBe(review);
    expect(overview.cyclePlans).toBe(cyclePlans);
    expect(overview.reviewError).toBeUndefined();
    expect(overview.cyclePlanError).toBeUndefined();
    expect(overview.exam).toBeUndefined();
    expect(overview.examError?.code).toBe("PLAN_NOT_FOUND");
  });

  it("keeps the active plan available for the quick exam editor", () => {
    const active = plan({
      targetExam: "研究生入学考试",
      examDate: "2026-12-20",
    });
    const overview = mergeOverviewResults("2026-08-10", [
      { status: "fulfilled", value: { restWeekdays: [], schemes: [] } },
      { status: "fulfilled", value: { restWeekdays: [], plans: [] } },
      {
        status: "fulfilled",
        value: [{ plan: active, stages: [], references: [] }],
      },
    ]);

    expect(overview.activePlan?.plan).toBe(active);
    expect(overview.exam?.examName).toBe("研究生入学考试");
  });
});
