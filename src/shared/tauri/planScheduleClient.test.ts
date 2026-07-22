import { describe, expect, it } from "vitest";

import {
  parsePlanTaskCreation,
  parsePlanTaskPreview,
} from "./planScheduleClient";

const TASK = {
  id: "task-id",
  subjectId: null,
  parentTaskId: null,
  title: "数据结构基础",
  description: null,
  plannedDate: "2026-07-20",
  estimatedMinutes: 90,
  priority: "normal",
  status: "todo",
  manualOrder: 0,
  completedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("plan schedule client parsers", () => {
  it("accepts an exact preview with existing dates", () => {
    const preview = parsePlanTaskPreview({
      stageId: "stage-id",
      planTitle: "408 计划",
      stageTitle: "基础阶段",
      items: [
        { plannedDate: "2026-07-20", alreadyExists: false },
        { plannedDate: "2026-07-22", alreadyExists: true },
      ],
      createCount: 1,
      existingCount: 1,
      sql: "private",
    });

    expect(preview.createCount).toBe(1);
    expect(JSON.stringify(preview)).not.toContain("sql");
  });

  it("rejects preview counts that do not match the date list", () => {
    expect(() =>
      parsePlanTaskPreview({
        stageId: "stage-id",
        planTitle: "408 计划",
        stageTitle: "基础阶段",
        items: [{ plannedDate: "2026-07-20", alreadyExists: false }],
        createCount: 0,
        existingCount: 0,
      }),
    ).toThrowError("PLAN_TASK_PREVIEW_INVALID");
  });

  it("returns created tasks without origin internals", () => {
    const creation = parsePlanTaskCreation({
      createdTasks: [TASK],
      skippedExisting: 2,
      stageTaskRows: ["private"],
    });

    expect(creation.createdTasks[0]?.plannedDate).toBe("2026-07-20");
    expect(JSON.stringify(creation)).not.toContain("stageTaskRows");
  });
});
