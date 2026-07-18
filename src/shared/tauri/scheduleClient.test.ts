import { describe, expect, it } from "vitest";

import {
  localDateForTimezone,
  normalizeScheduleCommandError,
  parseStudyTask,
  parseTaskList,
} from "./scheduleClient";

const VALID_TASK = {
  id: "019f7328-4b66-7613-9729-e3570fc41525",
  subjectId: null,
  parentTaskId: null,
  title: "线性代数强化",
  description: null,
  plannedDate: "2026-07-18",
  estimatedMinutes: 90,
  priority: "normal",
  status: "todo",
  manualOrder: 0,
  completedAt: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

describe("parseStudyTask", () => {
  it("returns typed task data without persistence internals", () => {
    const task = parseStudyTask(VALID_TASK);

    expect(task.title).toBe("线性代数强化");
    expect(task.subjectId).toBeUndefined();
  });

  it("rejects done state without a completion timestamp", () => {
    expect(() =>
      parseStudyTask({ ...VALID_TASK, status: "done" }),
    ).toThrowError("TASK_DTO_INVALID");
  });

  it("rejects an out-of-range estimate", () => {
    expect(() =>
      parseStudyTask({ ...VALID_TASK, estimatedMinutes: 1441 }),
    ).toThrowError("TASK_DTO_INVALID");
  });
});

describe("parseTaskList", () => {
  it("rejects a non-array response", () => {
    expect(() => parseTaskList({ task: VALID_TASK })).toThrowError(
      "TASK_LIST_DTO_INVALID",
    );
  });
});

describe("localDateForTimezone", () => {
  it("uses the workspace timezone instead of the machine date", () => {
    const date = new Date("2026-07-17T16:30:00.000Z");

    expect(localDateForTimezone(date, "Asia/Shanghai")).toBe("2026-07-18");
  });
});

describe("normalizeScheduleCommandError", () => {
  it("maps stable codes without trusting backend text", () => {
    const error = normalizeScheduleCommandError({
      code: "SCHEDULE_INPUT_INVALID",
      message: "C:\\private\\workspace\\kystudy.sqlite3",
      operationId: "operation-1",
    });

    expect(error.message).toBe("任务内容不符合要求。");
    expect(error.operationId).toBe("operation-1");
  });
});
