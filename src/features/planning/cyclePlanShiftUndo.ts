import type {
  CyclePlanShiftUndo,
  UndoCyclePlanShiftRequest,
} from "../../shared/tauri/cyclePlanClient";

export const CYCLE_PLAN_SHIFT_UNDO_WINDOW_MS = 5_000;

export type CyclePlanShiftUndoAction = CyclePlanShiftUndo;

export function createCyclePlanShiftUndoAction(
  planId: string,
  undo: CyclePlanShiftUndo | null,
  now = Date.now(),
): CyclePlanShiftUndoAction | undefined {
  if (undo === null) {
    return undefined;
  }
  if (
    typeof planId !== "string" ||
    planId.length === 0 ||
    !isValidUndo(undo) ||
    undo.planId !== planId ||
    undo.expiresAt <= now
  ) {
    throw new Error("CYCLE_PLAN_SHIFT_UNDO_INVALID");
  }
  return {
    planId: undo.planId,
    undoToken: undo.undoToken,
    expiresAt: undo.expiresAt,
  };
}

export function isCyclePlanShiftUndoExpired(
  action: CyclePlanShiftUndoAction,
  now = Date.now(),
): boolean {
  return now >= action.expiresAt;
}

export function createCyclePlanShiftUndoRequest(
  action: CyclePlanShiftUndoAction,
): UndoCyclePlanShiftRequest {
  return {
    planId: action.planId,
    undoToken: action.undoToken,
  };
}

export function cyclePlanShiftUndoIdentity(
  action: CyclePlanShiftUndoAction,
): string {
  return `${action.planId}:${action.undoToken}:${action.expiresAt}`;
}

function isValidUndo(value: CyclePlanShiftUndo): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.planId === "string" &&
    value.planId.length > 0 &&
    typeof value.undoToken === "string" &&
    value.undoToken.trim().length > 0 &&
    Number.isSafeInteger(value.expiresAt) &&
    value.expiresAt >= 0
  );
}
