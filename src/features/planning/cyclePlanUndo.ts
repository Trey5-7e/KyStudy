import type {
  CyclePlanItem,
  CyclePlanItemState,
  CyclePlanItemStateMutation,
  RestoreCyclePlanItemStateRequest,
} from "../../shared/tauri/cyclePlanClient";

export const CYCLE_PLAN_UNDO_WINDOW_MS = 5_000;

export interface CyclePlanUndoAction {
  itemId: string;
  state: CyclePlanItemState;
  completedAt?: number;
  skippedAt?: number;
  expectedUpdatedAt: number;
  expiresAt: number;
}

export function createCyclePlanUndoAction(
  before: CyclePlanItem,
  mutation: CyclePlanItemStateMutation,
  now = Date.now(),
): CyclePlanUndoAction {
  if (
    !isValidItem(before) ||
    !isValidMutation(mutation) ||
    before.id !== mutation.itemId ||
    mutation.itemUpdatedAt <= before.updatedAt
  ) {
    throw new Error("CYCLE_PLAN_UNDO_INVALID");
  }

  const action: CyclePlanUndoAction = {
    itemId: before.id,
    state: before.state,
    expectedUpdatedAt: mutation.itemUpdatedAt,
    expiresAt: now + CYCLE_PLAN_UNDO_WINDOW_MS,
  };
  if (before.completedAt !== undefined) {
    action.completedAt = before.completedAt;
  }
  if (before.skippedAt !== undefined) {
    action.skippedAt = before.skippedAt;
  }
  return action;
}

export function isCyclePlanUndoExpired(
  action: CyclePlanUndoAction,
  now = Date.now(),
): boolean {
  return now >= action.expiresAt;
}

export function createCyclePlanUndoRequest(
  action: CyclePlanUndoAction,
): RestoreCyclePlanItemStateRequest {
  const request: RestoreCyclePlanItemStateRequest = {
    itemId: action.itemId,
    state: action.state,
    expectedUpdatedAt: action.expectedUpdatedAt,
  };
  if (action.completedAt !== undefined) {
    request.completedAt = action.completedAt;
  }
  if (action.skippedAt !== undefined) {
    request.skippedAt = action.skippedAt;
  }
  return request;
}

export function cyclePlanUndoIdentity(
  action: Pick<
    CyclePlanUndoAction,
    "itemId" | "expectedUpdatedAt" | "expiresAt"
  >,
): string {
  return `${action.itemId}:${action.expectedUpdatedAt}:${action.expiresAt}`;
}

function isValidItem(value: CyclePlanItem): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    (value.state === "pending" ||
      value.state === "completed" ||
      value.state === "skipped") &&
    (value.completedAt === undefined ||
      (Number.isSafeInteger(value.completedAt) && value.completedAt >= 0)) &&
    (value.skippedAt === undefined ||
      (Number.isSafeInteger(value.skippedAt) && value.skippedAt >= 0)) &&
    (value.state === "completed") === (value.completedAt !== undefined) &&
    (value.state === "skipped") === (value.skippedAt !== undefined) &&
    Number.isSafeInteger(value.updatedAt) &&
    value.updatedAt >= 0
  );
}

function isValidMutation(value: CyclePlanItemStateMutation): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.itemId === "string" &&
    value.itemId.length > 0 &&
    Number.isSafeInteger(value.itemUpdatedAt) &&
    value.itemUpdatedAt >= 0 &&
    typeof value.dashboard === "object" &&
    value.dashboard !== null
  );
}
