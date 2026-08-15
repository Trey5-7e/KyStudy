import { describe, expect, it } from "vitest";

import {
  CYCLE_PLAN_SHIFT_UNDO_WINDOW_MS,
  createCyclePlanShiftUndoAction,
  createCyclePlanShiftUndoRequest,
  cyclePlanShiftUndoIdentity,
  isCyclePlanShiftUndoExpired,
} from "./cyclePlanShiftUndo";

const UNDO = {
  planId: "plan-id",
  undoToken: "opaque-server-token",
  expiresAt: 6_000,
};

describe("cycle plan shift undo model", () => {
  it("creates an exact server-token request and identity", () => {
    const action = createCyclePlanShiftUndoAction("plan-id", UNDO, 1_000);

    expect(action).toEqual(UNDO);
    expect(createCyclePlanShiftUndoRequest(action!)).toEqual({
      planId: "plan-id",
      undoToken: "opaque-server-token",
    });
    expect(cyclePlanShiftUndoIdentity(action!)).toBe(
      "plan-id:opaque-server-token:6000",
    );
  });

  it("uses the server expiry boundary and keeps the named window available", () => {
    expect(CYCLE_PLAN_SHIFT_UNDO_WINDOW_MS).toBe(5_000);
    const action = createCyclePlanShiftUndoAction("plan-id", UNDO, 1_000)!;

    expect(isCyclePlanShiftUndoExpired(action, 5_999)).toBe(false);
    expect(isCyclePlanShiftUndoExpired(action, 6_000)).toBe(true);
  });

  it("returns no action for a no-op shift", () => {
    expect(
      createCyclePlanShiftUndoAction("plan-id", null, 1_000),
    ).toBeUndefined();
  });

  it("replaces identity for a newer token while accepting opaque formats", () => {
    const replacement = createCyclePlanShiftUndoAction(
      "plan-id",
      { ...UNDO, undoToken: "server-token-v2", expiresAt: 7_000 },
      1_000,
    )!;

    expect(cyclePlanShiftUndoIdentity(replacement)).not.toBe(
      cyclePlanShiftUndoIdentity(UNDO),
    );
  });

  it("rejects mismatched plans, blank tokens, and expired server descriptors", () => {
    expect(() =>
      createCyclePlanShiftUndoAction("other-plan", UNDO, 1_000),
    ).toThrowError("CYCLE_PLAN_SHIFT_UNDO_INVALID");
    expect(() =>
      createCyclePlanShiftUndoAction(
        "plan-id",
        { ...UNDO, undoToken: "   " },
        1_000,
      ),
    ).toThrowError("CYCLE_PLAN_SHIFT_UNDO_INVALID");
    expect(() =>
      createCyclePlanShiftUndoAction(
        "plan-id",
        { ...UNDO, expiresAt: 1_000 },
        1_000,
      ),
    ).toThrowError("CYCLE_PLAN_SHIFT_UNDO_INVALID");
  });
});
