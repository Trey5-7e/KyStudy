import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import {
  archiveCyclePlan,
  confirmCyclePlanShift,
  normalizeCyclePlanError,
  parseDashboard,
  parseCyclePlanItemStateMutation,
  parseCyclePlanShiftMutation,
  parseCyclePlanShiftPreview,
  previewCyclePlanShift,
  restoreCyclePlanItemState,
  saveCyclePlan,
  setCyclePlanItemState,
  undoCyclePlanShift,
} from "./cyclePlanClient";

const mockedInvoke = vi.mocked(invoke);

const VALUE = {
  restWeekdays: [6],
  plans: [
    {
      plan: {
        id: "plan-id",
        name: "数学模拟卷",
        totalUnits: 20,
        unitLabel: "套",
        startDate: "2026-07-29",
        deadline: "2026-09-30",
        studyDaysPerUnit: 2,
        scheduleMode: "rhythm",
        calendarVisible: true,
        createdAt: 1,
        updatedAt: 2,
      },
      items: [
        {
          id: "item-id",
          planId: "plan-id",
          unitIndex: 1,
          plannedStartDate: "2026-07-29",
          plannedEndDate: "2026-07-30",
          originalStartDate: "2026-07-29",
          originalEndDate: "2026-07-30",
          state: "pending",
          completedAt: null,
          skippedAt: null,
          shiftCount: 0,
          updatedAt: 3,
        },
      ],
      completedCount: 0,
      skippedCount: 0,
      progressPercent: 0,
      estimatedEndDate: "2026-09-14",
      exceedsDeadline: false,
      recommendedStudyDaysPerUnit: null,
      recommendedTotalUnits: null,
    },
  ],
};

const MUTATION_VALUE = {
  dashboard: VALUE,
  itemId: "item-id",
  itemUpdatedAt: 4,
};

const SHIFT_MUTATION_VALUE = {
  dashboard: VALUE,
  shiftedItemCount: 1,
  undo: {
    planId: "plan-id",
    undoToken: "opaque-server-token",
    expiresAt: 1_700_000_005_000,
  },
};

const SHIFT_PREVIEW_VALUE = {
  planId: "plan-id",
  fromDate: "2026-07-29",
  studyDays: 1,
  affectedItemCount: 3,
  currentEstimatedEndDate: "2026-09-14",
  newEstimatedEndDate: "2026-09-17",
  deadline: "2026-09-15",
  exceedsDeadlineByDays: 2,
  restWeekdays: [5, 6],
  previewToken: "opaque-preview-token",
};

describe("parse cycle plan dashboard", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("keeps typed plan progress and multi-day items", () => {
    const dashboard = parseDashboard(VALUE);

    expect(dashboard.plans[0]?.items[0]?.plannedEndDate).toBe("2026-07-30");
    expect(dashboard.plans[0]?.progressPercent).toBe(0);
    expect(dashboard.plans[0]?.skippedCount).toBe(0);
    expect(dashboard.plans[0]?.items[0]?.updatedAt).toBe(3);
  });

  it("rejects an item without an optimistic-concurrency token", () => {
    expect(() =>
      parseDashboard({
        ...VALUE,
        plans: [
          {
            ...VALUE.plans[0],
            items: [{ ...VALUE.plans[0]?.items[0], updatedAt: undefined }],
          },
        ],
      }),
    ).toThrowError("CYCLE_PLAN_ITEM_INVALID");
  });

  it("rejects an invalid progress percentage", () => {
    expect(() =>
      parseDashboard({
        ...VALUE,
        plans: [{ ...VALUE.plans[0], progressPercent: 101 }],
      }),
    ).toThrowError("CYCLE_PLAN_OVERVIEW_INVALID");
  });

  it("parses skipped items and rejects invalid state timestamps", () => {
    const skipped = parseDashboard({
      ...VALUE,
      plans: [
        {
          ...VALUE.plans[0],
          skippedCount: 1,
          items: [
            {
              ...VALUE.plans[0]?.items[0],
              state: "skipped",
              skippedAt: 4,
            },
          ],
        },
      ],
    });
    expect(skipped.plans[0]?.items[0]).toMatchObject({
      state: "skipped",
      skippedAt: 4,
      completedAt: undefined,
    });

    for (const item of [
      { ...VALUE.plans[0]?.items[0], state: "completed" },
      { ...VALUE.plans[0]?.items[0], state: "pending", completedAt: 4 },
      { ...VALUE.plans[0]?.items[0], state: "skipped", skippedAt: null },
    ]) {
      expect(() =>
        parseDashboard({
          ...VALUE,
          plans: [{ ...VALUE.plans[0], items: [item] }],
        }),
      ).toThrowError("CYCLE_PLAN_ITEM_INVALID");
    }
  });

  it("rejects impossible completed and skipped totals", () => {
    expect(() =>
      parseDashboard({
        ...VALUE,
        plans: [
          {
            ...VALUE.plans[0],
            completedCount: 20,
            skippedCount: 1,
          },
        ],
      }),
    ).toThrowError("CYCLE_PLAN_OVERVIEW_INVALID");
  });

  it("parses the authoritative item-state mutation token", () => {
    const mutation = parseCyclePlanItemStateMutation(MUTATION_VALUE);

    expect(mutation.itemId).toBe("item-id");
    expect(mutation.itemUpdatedAt).toBe(4);
    expect(mutation.dashboard.plans[0]?.items[0]?.updatedAt).toBe(3);
  });

  it("rejects malformed item-state mutation wrappers", () => {
    expect(() =>
      parseCyclePlanItemStateMutation({
        ...MUTATION_VALUE,
        itemUpdatedAt: undefined,
      }),
    ).toThrowError("CYCLE_PLAN_ITEM_STATE_MUTATION_INVALID");
  });

  it("parses a server-authored shift undo and its no-op null", () => {
    const mutation = parseCyclePlanShiftMutation(SHIFT_MUTATION_VALUE);
    expect(mutation.shiftedItemCount).toBe(1);
    expect(mutation.undo).toEqual(SHIFT_MUTATION_VALUE.undo);
    expect(mutation.dashboard.plans[0]?.items[0]?.updatedAt).toBe(3);
    expect(
      parseCyclePlanShiftMutation({
        ...SHIFT_MUTATION_VALUE,
        shiftedItemCount: 0,
        undo: null,
      }).undo,
    ).toBeNull();
  });

  it("rejects a malformed shift undo token", () => {
    expect(() =>
      parseCyclePlanShiftMutation({
        ...SHIFT_MUTATION_VALUE,
        undo: { ...SHIFT_MUTATION_VALUE.undo, undoToken: " " },
      }),
    ).toThrowError("CYCLE_PLAN_SHIFT_UNDO_INVALID");
    expect(() =>
      parseCyclePlanShiftMutation({
        ...SHIFT_MUTATION_VALUE,
        shiftedItemCount: 0,
      }),
    ).toThrowError("CYCLE_PLAN_SHIFT_MUTATION_INVALID");
  });

  it("parses a server-authored shift preview and a no-op", () => {
    expect(parseCyclePlanShiftPreview(SHIFT_PREVIEW_VALUE)).toEqual(
      SHIFT_PREVIEW_VALUE,
    );
    expect(
      parseCyclePlanShiftPreview({
        ...SHIFT_PREVIEW_VALUE,
        affectedItemCount: 0,
        previewToken: null,
      }).previewToken,
    ).toBeNull();
  });

  it("rejects invalid preview tokens, dates, weekdays, and count relations", () => {
    for (const value of [
      { ...SHIFT_PREVIEW_VALUE, previewToken: " " },
      { ...SHIFT_PREVIEW_VALUE, fromDate: "29-07-2026" },
      { ...SHIFT_PREVIEW_VALUE, restWeekdays: [6, 6] },
      { ...SHIFT_PREVIEW_VALUE, affectedItemCount: 0 },
      { ...SHIFT_PREVIEW_VALUE, previewToken: null },
    ]) {
      expect(() => parseCyclePlanShiftPreview(value)).toThrowError(
        "CYCLE_PLAN_SHIFT_PREVIEW_INVALID",
      );
    }
  });
});

describe("cycle plan item state commands", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("sends the expected updated-at token when changing state", async () => {
    mockedInvoke.mockResolvedValue(MUTATION_VALUE);

    const mutation = await setCyclePlanItemState({
      itemId: "item-id",
      targetState: "completed",
      expectedUpdatedAt: 3,
    });

    expect(mutation.itemUpdatedAt).toBe(4);

    expect(mockedInvoke).toHaveBeenCalledWith("set_cycle_plan_item_state", {
      request: {
        itemId: "item-id",
        targetState: "completed",
        expectedUpdatedAt: 3,
      },
    });
  });

  it("sends an exact skipped-state intent", async () => {
    mockedInvoke.mockResolvedValue(MUTATION_VALUE);

    await setCyclePlanItemState({
      itemId: "item-id",
      targetState: "skipped",
      expectedUpdatedAt: 3,
    });

    expect(mockedInvoke).toHaveBeenCalledWith("set_cycle_plan_item_state", {
      request: {
        itemId: "item-id",
        targetState: "skipped",
        expectedUpdatedAt: 3,
      },
    });
  });

  it("sends the exact restore request shape", async () => {
    mockedInvoke.mockResolvedValue(VALUE);

    await restoreCyclePlanItemState({
      itemId: "item-id",
      state: "skipped",
      completedAt: undefined,
      skippedAt: 2,
      expectedUpdatedAt: 3,
    });

    expect(mockedInvoke).toHaveBeenCalledWith("restore_cycle_plan_item_state", {
      request: {
        itemId: "item-id",
        state: "skipped",
        completedAt: undefined,
        skippedAt: 2,
        expectedUpdatedAt: 3,
      },
    });
  });
});

describe("cycle plan save commands", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("omits the update token when creating a plan", async () => {
    mockedInvoke.mockResolvedValue(VALUE);
    const request = {
      name: "数学模拟卷",
      totalUnits: 20,
      unitLabel: "套",
      startDate: "2026-07-29",
      deadline: "2026-09-30",
      studyDaysPerUnit: 2,
      scheduleMode: "rhythm" as const,
      calendarVisible: true,
    };

    await saveCyclePlan(request);

    expect(request).not.toHaveProperty("expectedUpdatedAt");
    expect(mockedInvoke).toHaveBeenCalledWith("save_cycle_plan", { request });
  });

  it("sends the exact baseline token when updating a plan", async () => {
    mockedInvoke.mockResolvedValue(VALUE);
    const request = {
      planId: "plan-id",
      expectedUpdatedAt: 2,
      name: "数学模拟卷",
      totalUnits: 20,
      unitLabel: "套",
      startDate: "2026-07-29",
      deadline: "2026-09-30",
      studyDaysPerUnit: 2,
      scheduleMode: "rhythm" as const,
      calendarVisible: false,
    };

    await saveCyclePlan(request);

    expect(mockedInvoke).toHaveBeenCalledWith("save_cycle_plan", { request });
  });

  it("sends the current plan token when archiving", async () => {
    mockedInvoke.mockResolvedValue(VALUE);

    await archiveCyclePlan("plan-id", 17);

    expect(mockedInvoke).toHaveBeenCalledWith("archive_cycle_plan", {
      planId: "plan-id",
      expectedUpdatedAt: 17,
    });
  });
});

describe("cycle plan shift commands", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("previews without writing and preserves the request shape", async () => {
    mockedInvoke.mockResolvedValue(SHIFT_PREVIEW_VALUE);

    const preview = await previewCyclePlanShift({
      planId: "plan-id",
      fromDate: "2026-07-29",
      studyDays: 1,
    });

    expect(preview.affectedItemCount).toBe(3);
    expect(mockedInvoke).toHaveBeenCalledWith("preview_cycle_plan_shift", {
      request: {
        planId: "plan-id",
        fromDate: "2026-07-29",
        studyDays: 1,
      },
    });
  });

  it("confirms with the exact intent and opaque preview token", async () => {
    mockedInvoke.mockResolvedValue(SHIFT_MUTATION_VALUE);

    const mutation = await confirmCyclePlanShift({
      planId: "plan-id",
      fromDate: "2026-07-29",
      studyDays: 1,
      previewToken: "opaque-preview-token",
    });

    expect(mutation.shiftedItemCount).toBe(1);
    expect(mockedInvoke).toHaveBeenCalledWith("confirm_cycle_plan_shift", {
      request: {
        planId: "plan-id",
        fromDate: "2026-07-29",
        studyDays: 1,
        previewToken: "opaque-preview-token",
      },
    });
  });

  it("sends only the plan and opaque undo token", async () => {
    mockedInvoke.mockResolvedValue(VALUE);

    await undoCyclePlanShift({
      planId: "plan-id",
      undoToken: "opaque-server-token",
    });

    expect(mockedInvoke).toHaveBeenCalledWith("undo_shift_cycle_plan", {
      request: {
        planId: "plan-id",
        undoToken: "opaque-server-token",
      },
    });
  });
});

describe("cycle plan errors", () => {
  it("keeps stale plan saves actionable", () => {
    expect(normalizeCyclePlanError({ code: "CYCLE_PLAN_SAVE_STALE" })).toEqual({
      code: "CYCLE_PLAN_SAVE_STALE",
      message: "周期计划已在其他窗口发生变化。",
      action: "刷新计划并重新核对编辑内容后再保存。",
    });
  });

  it("explains completed item sequence conflicts when shrinking a plan", () => {
    expect(
      normalizeCyclePlanError({ code: "CYCLE_PLAN_COMPLETED_CONFLICT" }),
    ).toEqual({
      code: "CYCLE_PLAN_COMPLETED_CONFLICT",
      message: "已有完成或跳过事项的序号超出新的总量。",
      action: "请增大总量，保留所有完成或跳过事项后再保存。",
    });
  });

  it("keeps stale item state errors stable and actionable", () => {
    expect(
      normalizeCyclePlanError({ code: "CYCLE_PLAN_ITEM_STATE_STALE" }),
    ).toEqual({
      code: "CYCLE_PLAN_ITEM_STATE_STALE",
      message: "计划事项的状态已发生变化。",
      action: "刷新周期计划后重试，避免覆盖最新状态。",
    });
  });

  it("keeps shift undo errors stable and actionable", () => {
    expect(
      normalizeCyclePlanError({ code: "CYCLE_PLAN_SHIFT_UNDO_UNAVAILABLE" }),
    ).toMatchObject({
      code: "CYCLE_PLAN_SHIFT_UNDO_UNAVAILABLE",
      message: "没有可撤销的周期计划顺延。",
    });
    expect(
      normalizeCyclePlanError({ code: "CYCLE_PLAN_SHIFT_UNDO_STALE" }),
    ).toMatchObject({
      code: "CYCLE_PLAN_SHIFT_UNDO_STALE",
      message: "周期计划顺延后的事项已发生变化。",
    });
  });

  it("keeps stale shift previews actionable", () => {
    expect(
      normalizeCyclePlanError({ code: "CYCLE_PLAN_SHIFT_PREVIEW_STALE" }),
    ).toEqual({
      code: "CYCLE_PLAN_SHIFT_PREVIEW_STALE",
      message: "顺延预览已与当前计划不一致。",
      action: "刷新预览并确认最新排程后重试。",
    });
  });
});
