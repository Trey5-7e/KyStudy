import { describe, expect, it } from "vitest";

import type {
  CyclePlanDashboard,
  CyclePlanItem,
  CyclePlanItemStateMutation,
} from "../../shared/tauri/cyclePlanClient";
import {
  CYCLE_PLAN_UNDO_WINDOW_MS,
  createCyclePlanUndoAction,
  createCyclePlanUndoRequest,
  cyclePlanUndoIdentity,
  isCyclePlanUndoExpired,
} from "./cyclePlanUndo";

function item(overrides: Partial<CyclePlanItem> = {}): CyclePlanItem {
  return {
    id: "item-id",
    planId: "plan-id",
    unitIndex: 1,
    plannedStartDate: "2026-07-29",
    plannedEndDate: "2026-07-30",
    originalStartDate: "2026-07-29",
    originalEndDate: "2026-07-30",
    state: "pending",
    completedAt: undefined,
    skippedAt: undefined,
    shiftCount: 0,
    updatedAt: 10,
    ...overrides,
  };
}

function mutation(
  overrides: Partial<CyclePlanItemStateMutation> = {},
): CyclePlanItemStateMutation {
  return {
    dashboard: {} as CyclePlanDashboard,
    itemId: "item-id",
    itemUpdatedAt: 11,
    ...overrides,
  };
}

describe("cycle plan undo model", () => {
  it("creates the exact pending restore descriptor", () => {
    const before = item({ state: "pending", completedAt: undefined });

    const action = createCyclePlanUndoAction(
      before,
      mutation({ itemUpdatedAt: 11 }),
      1_000,
    );

    expect(action).toEqual({
      itemId: "item-id",
      state: "pending",
      expectedUpdatedAt: 11,
      expiresAt: 1_000 + CYCLE_PLAN_UNDO_WINDOW_MS,
    });
    expect(createCyclePlanUndoRequest(action)).toEqual({
      itemId: "item-id",
      state: "pending",
      expectedUpdatedAt: 11,
    });
  });

  it("preserves the completed state and timestamp for a completed item", () => {
    const before = item({ state: "completed", completedAt: 20, updatedAt: 11 });

    const action = createCyclePlanUndoAction(
      before,
      mutation({ itemUpdatedAt: 12 }),
      2_000,
    );

    expect(action).toEqual({
      itemId: "item-id",
      state: "completed",
      completedAt: 20,
      expectedUpdatedAt: 12,
      expiresAt: 2_000 + CYCLE_PLAN_UNDO_WINDOW_MS,
    });
    expect(createCyclePlanUndoRequest(action)).toEqual({
      itemId: "item-id",
      state: "completed",
      completedAt: 20,
      expectedUpdatedAt: 12,
    });
  });

  it("preserves the skipped state and timestamp", () => {
    const before = item({ state: "skipped", skippedAt: 21, updatedAt: 12 });

    const action = createCyclePlanUndoAction(
      before,
      mutation({ itemUpdatedAt: 13 }),
      3_000,
    );

    expect(action).toEqual({
      itemId: "item-id",
      state: "skipped",
      skippedAt: 21,
      expectedUpdatedAt: 13,
      expiresAt: 3_000 + CYCLE_PLAN_UNDO_WINDOW_MS,
    });
    expect(createCyclePlanUndoRequest(action)).toEqual({
      itemId: "item-id",
      state: "skipped",
      skippedAt: 21,
      expectedUpdatedAt: 13,
    });
  });

  it("replaces the identity when a newer action has a new token or window", () => {
    const first = createCyclePlanUndoAction(
      item({ updatedAt: 1 }),
      mutation({ itemUpdatedAt: 2 }),
      1_000,
    );
    const replacement = createCyclePlanUndoAction(
      item({ updatedAt: 2 }),
      mutation({ itemUpdatedAt: 3 }),
      1_001,
    );

    expect(cyclePlanUndoIdentity(first)).not.toBe(
      cyclePlanUndoIdentity(replacement),
    );
    expect(isCyclePlanUndoExpired(first, first.expiresAt - 1)).toBe(false);
    expect(isCyclePlanUndoExpired(first, first.expiresAt)).toBe(true);
    expect(isCyclePlanUndoExpired(first, first.expiresAt + 1)).toBe(true);
  });

  it("uses the mutation token even when its dashboard has a newer same-item row", () => {
    const action = createCyclePlanUndoAction(
      item({ updatedAt: 10 }),
      mutation({
        itemUpdatedAt: 11,
        dashboard: {
          plans: [{ items: [item({ updatedAt: 99 })] }],
        } as unknown as CyclePlanDashboard,
      }),
      1_000,
    );

    expect(action.expectedUpdatedAt).toBe(11);
  });

  it("rejects a mutation without a matching identity or newer version", () => {
    expect(() =>
      createCyclePlanUndoAction(
        item(),
        mutation({ itemId: "other-item" }),
        1_000,
      ),
    ).toThrowError("CYCLE_PLAN_UNDO_INVALID");
    expect(() =>
      createCyclePlanUndoAction(
        item(),
        mutation({ itemUpdatedAt: undefined as unknown as number }),
        1_000,
      ),
    ).toThrowError("CYCLE_PLAN_UNDO_INVALID");
    expect(() =>
      createCyclePlanUndoAction(
        item({ updatedAt: 11 }),
        mutation({ itemUpdatedAt: 11 }),
        1_000,
      ),
    ).toThrowError("CYCLE_PLAN_UNDO_INVALID");
    expect(() =>
      createCyclePlanUndoAction(
        item({ state: "skipped", skippedAt: undefined }),
        mutation(),
        1_000,
      ),
    ).toThrowError("CYCLE_PLAN_UNDO_INVALID");
  });
});
