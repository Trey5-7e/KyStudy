import { describe, expect, it } from "vitest";

import { parsePlanExecutionProgress } from "./planProgressClient";

const FIRST = {
  generatedTaskCount: 4,
  effectiveTaskCount: 2,
  completedTaskCount: 1,
  remainingTaskCount: 1,
  overdueTaskCount: 1,
  canceledTaskCount: 1,
  trashedTaskCount: 1,
  plannedMinutes: 120,
  actualMinutes: 25,
  completionRatePercent: 50,
};

const SECOND = {
  generatedTaskCount: 2,
  effectiveTaskCount: 2,
  completedTaskCount: 2,
  remainingTaskCount: 0,
  overdueTaskCount: 0,
  canceledTaskCount: 0,
  trashedTaskCount: 0,
  plannedMinutes: 90,
  actualMinutes: 100,
  completionRatePercent: 100,
};

function validOverview() {
  return {
    planId: "plan-id",
    planTitle: "408 计划",
    planStatus: "active",
    summary: {
      generatedTaskCount: 6,
      effectiveTaskCount: 4,
      completedTaskCount: 3,
      remainingTaskCount: 1,
      overdueTaskCount: 1,
      canceledTaskCount: 1,
      trashedTaskCount: 1,
      plannedMinutes: 210,
      actualMinutes: 125,
      completionRatePercent: 75,
    },
    stages: [
      {
        stageId: "stage-a",
        stageTitle: "基础阶段",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        summary: { ...FIRST },
        sql: "private",
      },
      {
        stageId: "stage-b",
        stageTitle: "强化阶段",
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        summary: { ...SECOND },
      },
    ],
    databasePath: "private",
  };
}

describe("plan progress client parser", () => {
  it("accepts consistent plan and stage totals without origin internals", () => {
    const progress = parsePlanExecutionProgress(validOverview());

    expect(progress.summary.completionRatePercent).toBe(75);
    expect(JSON.stringify(progress)).not.toContain("sql");
    expect(JSON.stringify(progress)).not.toContain("databasePath");
  });

  it("rejects a stage that hides an unclassified generated task", () => {
    const value = validOverview();
    value.stages[0]!.summary.generatedTaskCount = 5;

    expect(() => parsePlanExecutionProgress(value)).toThrowError(
      "PLAN_PROGRESS_SUMMARY_INVALID",
    );
  });

  it("rejects a plan summary that differs from its stages", () => {
    const value = validOverview();
    value.summary.actualMinutes = 124;

    expect(() => parsePlanExecutionProgress(value)).toThrowError(
      "PLAN_EXECUTION_PROGRESS_INVALID",
    );
  });
});
