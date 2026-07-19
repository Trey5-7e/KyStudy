import { describe, expect, it } from "vitest";

import {
  localDateForTimezone,
  normalizeScheduleCommandError,
  parseStudySubject,
  parseStudySession,
  parseStudyStatistics,
  parseStudyTask,
  parseStudyTaskChange,
  parseSubjectList,
  parseTaskChangeList,
  parseTaskList,
  parseTaskSplitResult,
  parseTrashedStudyTask,
} from "./scheduleClient";

const VALID_SUBJECT = {
  id: "019f7328-4b66-7613-9729-e3570fc41525",
  name: "408",
  colorKey: "blue",
  sortOrder: 0,
  archivedAt: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

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

const VALID_CHANGE = {
  id: "019f7328-4b66-7613-9729-e3570fc41526",
  changeType: "rescheduled",
  before: {
    subjectId: null,
    title: "线性代数强化",
    description: null,
    plannedDate: "2026-07-18",
    estimatedMinutes: 90,
    priority: "normal",
    status: "todo",
    manualOrder: 0,
    completedAt: null,
  },
  after: {
    subjectId: null,
    title: "线性代数强化",
    description: null,
    plannedDate: "2026-07-20",
    estimatedMinutes: 90,
    priority: "normal",
    status: "todo",
    manualOrder: 0,
    completedAt: null,
  },
  reason: "先完成前置章节",
  createdAt: 1_700_000_000_100,
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

describe("parseStudySubject", () => {
  it("returns an active subject without an archived timestamp", () => {
    const subject = parseStudySubject(VALID_SUBJECT);

    expect(subject.name).toBe("408");
    expect(subject.archivedAt).toBeUndefined();
  });

  it("accepts a safe archived subject", () => {
    const subject = parseStudySubject({
      ...VALID_SUBJECT,
      archivedAt: 1_700_000_000_100,
      updatedAt: 1_700_000_000_100,
    });

    expect(subject.archivedAt).toBe(1_700_000_000_100);
  });

  it("rejects an unknown color token", () => {
    expect(() =>
      parseStudySubject({ ...VALID_SUBJECT, colorKey: "url(secret)" }),
    ).toThrowError("SUBJECT_DTO_INVALID");
  });
});

describe("parseSubjectList", () => {
  it("rejects a non-array response", () => {
    expect(() => parseSubjectList({ subject: VALID_SUBJECT })).toThrowError(
      "SUBJECT_LIST_DTO_INVALID",
    );
  });
});

describe("parseTaskList", () => {
  it("rejects a non-array response", () => {
    expect(() => parseTaskList({ task: VALID_TASK })).toThrowError(
      "TASK_LIST_DTO_INVALID",
    );
  });
});

describe("parseStudyTaskChange", () => {
  it("returns typed snapshots without raw audit JSON", () => {
    const change = parseStudyTaskChange({
      ...VALID_CHANGE,
      beforeJson: "C:\\private\\audit.json",
    });

    expect(change.before?.plannedDate).toBe("2026-07-18");
    expect("beforeJson" in change).toBe(false);
  });

  it("rejects a reschedule without a reason", () => {
    expect(() =>
      parseStudyTaskChange({ ...VALID_CHANGE, reason: null }),
    ).toThrowError("TASK_CHANGE_DTO_INVALID");
  });

  it("rejects raw JSON without typed snapshots", () => {
    expect(() =>
      parseStudyTaskChange({
        id: VALID_CHANGE.id,
        changeType: "edited",
        beforeJson: "{}",
        afterJson: "{}",
        reason: null,
        createdAt: VALID_CHANGE.createdAt,
      }),
    ).toThrowError("TASK_CHANGE_DTO_INVALID");
  });
});

describe("parseTaskChangeList", () => {
  it("rejects a non-array response", () => {
    expect(() => parseTaskChangeList({ change: VALID_CHANGE })).toThrowError(
      "TASK_CHANGE_LIST_DTO_INVALID",
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

describe("parseTaskSplitResult", () => {
  it("accepts canceled parent and inherited child fields", () => {
    const parent = { ...VALID_TASK, status: "canceled" };
    const children = [1, 2].map((index) => ({
      ...VALID_TASK,
      id: `019f7328-4b66-7613-9729-e3570fc4152${index}`,
      parentTaskId: VALID_TASK.id,
      title: `子任务 ${index}`,
    }));

    const result = parseTaskSplitResult({ parent, children });

    expect(result.children).toHaveLength(2);
  });

  it("rejects a child that changes the inherited date", () => {
    expect(() =>
      parseTaskSplitResult({
        parent: { ...VALID_TASK, status: "canceled" },
        children: [
          { ...VALID_TASK, parentTaskId: VALID_TASK.id },
          {
            ...VALID_TASK,
            id: "019f7328-4b66-7613-9729-e3570fc41527",
            parentTaskId: VALID_TASK.id,
            plannedDate: "2026-07-19",
          },
        ],
      }),
    ).toThrowError("TASK_SPLIT_DTO_INVALID");
  });
});

describe("parseTrashedStudyTask", () => {
  it("returns only controlled task fields and deletion time", () => {
    const task = parseTrashedStudyTask({
      ...VALID_TASK,
      updatedAt: 1_700_000_000_100,
      deletedAt: 1_700_000_000_100,
      databasePath: "F:\\private\\kystudy.sqlite3",
    });

    expect(task.deletedAt).toBe(1_700_000_000_100);
    expect("databasePath" in task).toBe(false);
  });
});

describe("parseStudySession", () => {
  it("parses an actual record without storage internals", () => {
    const session = parseStudySession({
      id: "019f7328-4b66-7613-9729-e3570fc41528",
      taskId: VALID_TASK.id,
      subjectId: null,
      sessionDate: "2026-07-18",
      durationMinutes: 45,
      completionPercent: 80,
      reflection: "复盘薄弱点",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      storageKey: "private/session.json",
    });

    expect(session.durationMinutes).toBe(45);
    expect("storageKey" in session).toBe(false);
  });
});

describe("parseStudyStatistics", () => {
  it("represents an empty completion rate as undefined", () => {
    const statistics = parseStudyStatistics({
      taskCount: 0,
      completedTaskCount: 0,
      completionRatePercent: null,
      plannedMinutes: 0,
      actualMinutes: 0,
      minuteDifference: 0,
      overdueTaskCount: 0,
      subjects: [],
    });

    expect(statistics.completionRatePercent).toBeUndefined();
  });

  it("rejects a fake perfect rate for empty data", () => {
    expect(() =>
      parseStudyStatistics({
        taskCount: 0,
        completedTaskCount: 0,
        completionRatePercent: 100,
        plannedMinutes: 0,
        actualMinutes: 0,
        minuteDifference: 0,
        overdueTaskCount: 0,
        subjects: [],
      }),
    ).toThrowError("STUDY_STATISTICS_DTO_INVALID");
  });
});
