import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PANEL_SOURCE = readFileSync(
  new URL("./CyclePlanPanel.tsx", import.meta.url),
  "utf8",
);
const WORKSPACE_SOURCE = readFileSync(
  new URL("./CyclePlanWorkspace.tsx", import.meta.url),
  "utf8",
);
const CALENDAR_WORKSPACE_SOURCE = readFileSync(
  new URL("./CyclePlanCalendarWorkspace.tsx", import.meta.url),
  "utf8",
);
const DIALOG_SOURCE = readFileSync(
  new URL("./CyclePlanDialog.tsx", import.meta.url),
  "utf8",
);
const EDITOR_SOURCE = readFileSync(
  new URL("./CyclePlanEditor.tsx", import.meta.url),
  "utf8",
);
const VIEW_MODEL_SOURCE = readFileSync(
  new URL("./cyclePlanViewModel.ts", import.meta.url),
  "utf8",
);
const SOURCE = [
  PANEL_SOURCE,
  WORKSPACE_SOURCE,
  CALENDAR_WORKSPACE_SOURCE,
  DIALOG_SOURCE,
  EDITOR_SOURCE,
  VIEW_MODEL_SOURCE,
].join("\n");

function section(startMarker: string, endMarker: string): string {
  const start = SOURCE.indexOf(startMarker);
  const end = SOURCE.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`missing CyclePlanPanel source marker: ${startMarker}`);
  }
  return SOURCE.slice(start, end);
}

function buttonForLabel(label: string): string {
  const labelIndex = SOURCE.indexOf(label);
  const start = SOURCE.lastIndexOf("<button", labelIndex);
  const end = SOURCE.indexOf("</button>", labelIndex);
  if (labelIndex < 0 || start < 0 || end < 0) {
    throw new Error(`missing CyclePlanPanel button label: ${label}`);
  }
  return SOURCE.slice(start, end);
}

describe("cycle plan navigation undo contract", () => {
  it("clears the latest action before closing, creating, or opening a plan", () => {
    expect(
      section("const closeWindow = () => {", "  const openCreate = "),
    ).toContain("invalidateUndo();");
    expect(
      section(
        "const openCreate = (trigger: HTMLButtonElement) => {",
        "  const openPlan = ",
      ),
    ).toContain("invalidateUndo();");
    expect(section("const openPlan = (", "  const startEdit = ")).toContain(
      "invalidateUndo();",
    );
  });

  it("clears the focus source with the action and guards timer replacement", () => {
    expect(SOURCE).toContain("lastUndoSourceRef.current = null;");
    expect(SOURCE).toContain("undoIdentityFor(current) !== undoIdentity");
    expect(SOURCE).toContain("const focusTarget = lastUndoSourceRef.current;");
    expect(SOURCE).toContain(
      "const previewFocusTarget = shiftPreviewHeadingRef.current;",
    );
  });
});

describe("cycle plan shift preview contract", () => {
  it("previews without writing or invalidating the latest undo", () => {
    const preview = section(
      "const loadShiftPreview = async",
      "  const openShiftPreview = ",
    );

    expect(preview).toContain("previewCyclePlanShift(request)");
    expect(preview).toContain("shiftPreviewRequestIdRef.current !== requestId");
    expect(preview).not.toContain("confirmCyclePlanShift");
    expect(preview).not.toContain("invalidateUndo();");
    expect(SOURCE).not.toContain("shiftCyclePlanFromDate");
    expect(
      section("const openShiftPreview = (", "  const refreshShiftPreview = "),
    ).not.toContain("invalidateUndo();");
  });

  it("confirms the server preview before replacing the latest undo", () => {
    const confirmation = section(
      "const confirmShiftPreview = async () => {",
      "  const markShiftPreviewStale = ",
    );

    expect(confirmation).toContain("confirmCyclePlanShift(");
    expect(confirmation).toContain(
      "createConfirmCyclePlanShiftRequest(preview)",
    );
    expect(confirmation).toContain(
      'setUndo({ kind: "shift", action, itemLabel: "顺延" });',
    );
    expect(confirmation).not.toContain("invalidateUndo();");
  });

  it("returns focus on cancel and keeps stale previews refresh-only", () => {
    const cancellation = section(
      "const cancelShiftPreview = () => {",
      "  const confirmShiftPreview = ",
    );
    expect(cancellation).toContain('setWindowMode("summary");');
    expect(cancellation).toContain("requestAnimationFrame");
    expect(cancellation).toContain("shiftButtonRef.current?.focus");
    expect(SOURCE).toContain(
      'normalized.code === "CYCLE_PLAN_SHIFT_PREVIEW_STALE"',
    );
    expect(SOURCE).toContain('state.status === "ready"');
  });

  it("owns the focus ref on the real shift button, not edit rules", () => {
    const editButton = buttonForLabel("编辑规则");
    const shiftButton = buttonForLabel(
      "从 {formatShortDate(selectedDate)} 后顺延 1 个学习日",
    );

    expect(editButton).toContain("onClick={onEdit}");
    expect(editButton).not.toContain("ref={shiftButtonRef}");
    expect(shiftButton).toContain("ref={shiftButtonRef}");
    expect(shiftButton).toContain("onClick={onShift}");
  });

  it("keeps operation status reachable inside the modal", () => {
    expect(SOURCE).toContain(
      "{openPlanId === undefined ? operationStatus : null}",
    );
    expect(section("<EditorDialog", "</EditorDialog>")).toContain(
      "{operationStatus}",
    );
  });

  it("marks an open preview stale after executing an older undo", () => {
    const undo = section(
      "const undoLatestAction = async () => {",
      "  const closeWindow = ",
    );
    expect(undo).toContain("markShiftPreviewStale();");
    expect(SOURCE).toContain("undoIdentityFor(current) !== undoIdentity");
  });
});

describe("cycle plan save concurrency contract", () => {
  it("omits a token for create and preserves the opened plan baseline", () => {
    const input = section(
      "export function toInput(draft: CyclePlanDraft)",
      "export function fromOverview",
    );
    const baseline = section(
      "export function fromOverview",
      "export function sameDraft",
    );

    expect(input).toContain("draft.planId === undefined");
    expect(input).toContain("{ expectedUpdatedAt: draft.expectedUpdatedAt }");
    expect(baseline).toContain("expectedUpdatedAt: plan.updatedAt");
  });

  it("sends the current plan token for visibility and suggested edits", () => {
    const management = section("onToggleCalendar={() =>", "onAskArchive=");

    expect(management).toContain(
      "expectedUpdatedAt: openOverview.plan.updatedAt",
    );
    expect(management.match(/fromOverview\(openOverview\)/g)).toHaveLength(5);
  });

  it("sends the current plan token when archiving", () => {
    const archive = section("onArchive={async () => {", "        />");

    expect(archive).toContain("openOverview.plan.updatedAt");
  });

  it("does not count the baseline token as a user edit", () => {
    const comparison = SOURCE.slice(
      SOURCE.indexOf("export function sameDraft"),
    );

    expect(comparison).toContain("expectedUpdatedAt: undefined");
  });

  it("keeps the controlled draft and dialog when a save fails stale", () => {
    const run = section(
      "const run = async (",
      "  const updateCycleItemState = ",
    );

    expect(run).toContain("setError(normalizeCyclePlanError(operationError));");
    expect(run).toContain("return false;");
    expect(run).not.toContain("setDraft(");
    expect(SOURCE).toContain("if (saved) {");
    expect(SOURCE).toContain("closeWindow();");
  });
});

describe("cycle plan editor integration contract", () => {
  it("connects the editor dirty state to the dialog guard", () => {
    expect(WORKSPACE_SOURCE).toContain("editingDirty={editingDirty}");
    expect(DIALOG_SOURCE).toContain("dirty={editingDirty}");
    expect(DIALOG_SOURCE).toContain("backRequiresConfirmation={windowMode !==");
  });

  it("only closes the editor after a successful save", () => {
    expect(EDITOR_SOURCE).toContain(
      "disabled={busy || !valid || preview === undefined}",
    );
    expect(DIALOG_SOURCE).toContain("const saved = await run(");
    expect(DIALOG_SOURCE).toContain("if (saved) {");
    expect(DIALOG_SOURCE).toContain("closeWindow();");
  });
});

describe("cycle plan rest-day refresh contract", () => {
  it("reads the dashboard after the backend-owned schedule refresh", () => {
    const restDays = section("<CycleRestDays", "            />");

    expect(restDays).toContain("await setReviewRestWeekdays(values, today);");
    expect(restDays).toContain("return getCyclePlanDashboard();");
    expect(restDays).not.toContain("refreshCyclePlanSchedules");
    expect(SOURCE).not.toContain("refreshCyclePlanSchedules");
  });
});

describe("cycle plan item skip contract", () => {
  it("uses explicit state actions instead of a whole-row toggle", () => {
    const items = section(
      "selectedItems.map(({ overview, item }) => {",
      "                })}",
    );

    expect(items).toContain("cyclePlanItemActions(item.state)");
    expect(items).toContain("cyclePlanItemStateLabel(item.state)");
    expect(items).toContain("action.targetState");
    expect(items).not.toContain("aria-pressed");
  });

  it("sends target state and stales an open shift preview", () => {
    const update = section(
      "const updateCycleItemState = async (",
      "  const loadShiftPreview = ",
    );

    expect(update).toContain("targetState,");
    expect(update).toContain("expectedUpdatedAt: item.updatedAt");
    expect(update).toContain("markShiftPreviewStale();");
    expect(update).toContain("itemActionRefs.current.get(item.id)");
  });

  it("counts skipped separately and selects only pending as next", () => {
    expect(SOURCE).toContain("已跳过 {overview.skippedCount} 项");
    expect(SOURCE).toContain(
      'overview.items.find((item) => item.state === "pending")',
    );
    expect(SOURCE).toContain('"没有待完成事项"');
  });
});
