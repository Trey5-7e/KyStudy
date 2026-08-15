import { useEffect, useRef, useState } from "react";

import "./planning.css";

import {
  archiveCyclePlan,
  confirmCyclePlanShift,
  getCyclePlanDashboard,
  normalizeCyclePlanError,
  previewCyclePlanShift,
  restoreCyclePlanItemState,
  saveCyclePlan,
  setCyclePlanItemState,
  undoCyclePlanShift,
  type CyclePlanCommandError,
  type CyclePlanDashboard,
  type CyclePlanItem,
  type CyclePlanItemState,
  type CyclePlanOverview,
  type PreviewCyclePlanShiftRequest,
} from "../../shared/tauri/cyclePlanClient";
import { setReviewRestWeekdays } from "../../shared/tauri/reviewSchemeClient";
import { PageHeader, PageStatus } from "../../shared/components/PagePrimitives";
import { localDate } from "./cycleCalendar";
import { cyclePlanItemTransitionNotice } from "./cyclePlanItemActions";
import {
  CYCLE_PLAN_UNDO_WINDOW_MS,
  createCyclePlanUndoAction,
  createCyclePlanUndoRequest,
} from "./cyclePlanUndo";
import {
  createCyclePlanShiftUndoAction,
  createCyclePlanShiftUndoRequest,
} from "./cyclePlanShiftUndo";
import {
  canConfirmCyclePlanShiftPreview,
  createConfirmCyclePlanShiftRequest,
  createCyclePlanShiftPreview,
  cyclePlanShiftPreviewIdentity,
  cyclePlanShiftPreviewRequestIdentity,
} from "./cyclePlanShiftPreview";
import {
  emptyDraft,
  isCyclePlanUndoExpiredFor,
  previewFromState,
  sameDraft,
  undoIdentityFor,
  type CyclePlanDraft,
  type CyclePlanPanelWindowMode,
  type CyclePlanShiftPreviewState,
  type CyclePlanUndoState,
} from "./cyclePlanViewModel";
import { CyclePlanWorkspace } from "./CyclePlanWorkspace";

const NEW_PLAN_ID = "__new_cycle_plan__";
type Draft = CyclePlanDraft;

export function CyclePlanPanel() {
  const today = localDate(new Date());
  const initialMonth = new Date();
  const [dashboard, setDashboard] = useState<CyclePlanDashboard>();
  const [draft, setDraft] = useState<Draft>();
  const [initialDraft, setInitialDraft] = useState<Draft>();
  const [selectedDate, setSelectedDate] = useState(today);
  const [month, setMonth] = useState({
    year: initialMonth.getFullYear(),
    month: initialMonth.getMonth(),
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<CyclePlanCommandError>();
  const [openPlanId, setOpenPlanId] = useState<string>();
  const [windowMode, setWindowMode] =
    useState<CyclePlanPanelWindowMode>("summary");
  const [shiftPreview, setShiftPreview] =
    useState<CyclePlanShiftPreviewState>();
  const planHeadingRef = useRef<HTMLHeadingElement>(null);
  const activeTriggerRef = useRef<HTMLButtonElement>(null);
  const shiftButtonRef = useRef<HTMLButtonElement>(null);
  const shiftPreviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const shiftPreviewRequestIdRef = useRef(0);
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const lastUndoSourceRef = useRef<HTMLButtonElement>(null);
  const itemActionRefs = useRef(new Map<string, HTMLButtonElement>());
  const [undo, setUndo] = useState<CyclePlanUndoState>();
  const [loadVersion, setLoadVersion] = useState(0);

  const undoIdentity = undo === undefined ? undefined : undoIdentityFor(undo);

  useEffect(() => {
    if (undo === undefined || undoIdentity === undefined) {
      return;
    }
    const delay = Math.min(
      CYCLE_PLAN_UNDO_WINDOW_MS,
      Math.max(0, undo.action.expiresAt - Date.now()),
    );
    const timeoutId = window.setTimeout(() => {
      if (!isCyclePlanUndoExpiredFor(undo)) {
        return;
      }
      const wasUndoFocused = document.activeElement === undoButtonRef.current;
      const focusTarget = lastUndoSourceRef.current;
      setUndo((current) =>
        current === undefined || undoIdentityFor(current) !== undoIdentity
          ? current
          : undefined,
      );
      if (wasUndoFocused) {
        const previewFocusTarget = shiftPreviewHeadingRef.current;
        if (previewFocusTarget?.isConnected) {
          previewFocusTarget.focus({ preventScroll: true });
        } else if (focusTarget?.isConnected) {
          focusTarget.focus({ preventScroll: true });
        }
      }
    }, delay);
    return () => window.clearTimeout(timeoutId);
  }, [undo, undoIdentity]);

  useEffect(() => {
    let active = true;
    void getCyclePlanDashboard().then(
      (value) => {
        if (active) {
          setDashboard(value);
        }
      },
      (loadError: unknown) => {
        if (active) {
          setError(normalizeCyclePlanError(loadError));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [loadVersion]);

  useEffect(() => {
    if (
      draft === undefined ||
      initialDraft === undefined ||
      sameDraft(draft, initialDraft)
    ) {
      return;
    }
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnUnsaved);
    return () => window.removeEventListener("beforeunload", warnUnsaved);
  }, [draft, initialDraft]);

  const invalidateUndo = () => {
    setUndo(undefined);
    lastUndoSourceRef.current = null;
  };

  const run = async (
    operation: () => Promise<CyclePlanDashboard>,
    success: string,
  ) => {
    invalidateUndo();
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      setDashboard(await operation());
      setNotice(success);
      return true;
    } catch (operationError: unknown) {
      setError(normalizeCyclePlanError(operationError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const updateCycleItemState = async (
    item: CyclePlanItem,
    targetState: CyclePlanItemState,
    itemLabel: string,
    trigger: HTMLButtonElement,
  ) => {
    invalidateUndo();
    lastUndoSourceRef.current = trigger;
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      const mutation = await setCyclePlanItemState({
        itemId: item.id,
        targetState,
        expectedUpdatedAt: item.updatedAt,
      });
      setDashboard(mutation.dashboard);
      setUndo({
        kind: "item",
        action: createCyclePlanUndoAction(item, mutation),
        itemLabel,
      });
      setNotice(cyclePlanItemTransitionNotice(item.state, targetState));
      markShiftPreviewStale();
      requestAnimationFrame(() => {
        lastUndoSourceRef.current = itemActionRefs.current.get(item.id) ?? null;
      });
    } catch (operationError: unknown) {
      setError(normalizeCyclePlanError(operationError));
    } finally {
      setBusy(false);
    }
  };

  const loadShiftPreview = async (request: PreviewCyclePlanShiftRequest) => {
    const requestId = shiftPreviewRequestIdRef.current + 1;
    shiftPreviewRequestIdRef.current = requestId;
    setShiftPreview((current) => ({
      status: "loading",
      request,
      preview:
        current !== undefined &&
        cyclePlanShiftPreviewRequestIdentity(current.request) ===
          cyclePlanShiftPreviewRequestIdentity(request)
          ? previewFromState(current)
          : undefined,
    }));
    try {
      const preview = createCyclePlanShiftPreview(
        request,
        await previewCyclePlanShift(request),
      );
      if (shiftPreviewRequestIdRef.current !== requestId) {
        return;
      }
      setShiftPreview({
        status: preview.affectedItemCount === 0 ? "empty" : "ready",
        request,
        preview,
      });
    } catch (operationError: unknown) {
      if (shiftPreviewRequestIdRef.current !== requestId) {
        return;
      }
      setShiftPreview((current) => ({
        status: "error",
        request,
        preview: current === undefined ? undefined : previewFromState(current),
        error: normalizeCyclePlanError(operationError),
      }));
    }
  };

  const openShiftPreview = (planId: string) => {
    const request = { planId, fromDate: selectedDate, studyDays: 1 };
    setWindowMode("shift-preview");
    void loadShiftPreview(request);
    requestAnimationFrame(() =>
      shiftPreviewHeadingRef.current?.focus({ preventScroll: true }),
    );
  };

  const refreshShiftPreview = () => {
    if (shiftPreview !== undefined) {
      void loadShiftPreview(shiftPreview.request);
    }
  };

  const cancelShiftPreview = () => {
    shiftPreviewRequestIdRef.current += 1;
    setShiftPreview(undefined);
    setWindowMode("summary");
    requestAnimationFrame(() =>
      shiftButtonRef.current?.focus({ preventScroll: true }),
    );
  };

  const confirmShiftPreview = async () => {
    if (
      shiftPreview === undefined ||
      shiftPreview.status !== "ready" ||
      shiftPreview.preview === undefined ||
      !canConfirmCyclePlanShiftPreview(shiftPreview.preview)
    ) {
      return;
    }
    const preview = shiftPreview.preview;
    const previewIdentity = cyclePlanShiftPreviewIdentity(preview);
    setShiftPreview({
      status: "confirming",
      request: shiftPreview.request,
      preview,
    });
    setBusy(true);
    setError(undefined);
    try {
      const mutation = await confirmCyclePlanShift(
        createConfirmCyclePlanShiftRequest(preview),
      );
      const action = createCyclePlanShiftUndoAction(
        preview.planId,
        mutation.undo,
      );
      if (action === undefined || mutation.shiftedItemCount === 0) {
        throw new Error("CYCLE_PLAN_SHIFT_MUTATION_INVALID");
      }
      setDashboard(mutation.dashboard);
      setUndo({ kind: "shift", action, itemLabel: "顺延" });
      setNotice(
        `选中日期后的 ${mutation.shiftedItemCount} 个未完成事项已顺延 ${preview.studyDays} 个学习日。`,
      );
      setShiftPreview(undefined);
      setWindowMode("summary");
      requestAnimationFrame(() => {
        lastUndoSourceRef.current = shiftButtonRef.current;
      });
    } catch (operationError: unknown) {
      const normalized = normalizeCyclePlanError(operationError);
      setShiftPreview((current) => {
        if (
          current === undefined ||
          current.preview === undefined ||
          cyclePlanShiftPreviewIdentity(current.preview) !== previewIdentity
        ) {
          return current;
        }
        return {
          status:
            normalized.code === "CYCLE_PLAN_SHIFT_PREVIEW_STALE"
              ? "stale"
              : "error",
          request: current.request,
          preview: current.preview,
          error: normalized,
        };
      });
    } finally {
      setBusy(false);
    }
  };

  const markShiftPreviewStale = () => {
    shiftPreviewRequestIdRef.current += 1;
    const stale = normalizeCyclePlanError({
      code: "CYCLE_PLAN_SHIFT_PREVIEW_STALE",
    });
    setShiftPreview((current) =>
      current === undefined
        ? current
        : {
            status: "stale",
            request: current.request,
            preview: previewFromState(current),
            error: stale,
          },
    );
  };

  const undoLatestAction = async () => {
    if (undo === undefined) {
      return;
    }
    const currentUndo = undo;
    const focusTarget = lastUndoSourceRef.current;
    invalidateUndo();
    if (isCyclePlanUndoExpiredFor(currentUndo)) {
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      if (currentUndo.kind === "item") {
        setDashboard(
          await restoreCyclePlanItemState(
            createCyclePlanUndoRequest(currentUndo.action),
          ),
        );
        setNotice(`已撤销${currentUndo.itemLabel}的事项状态。`);
      } else {
        setDashboard(
          await undoCyclePlanShift(
            createCyclePlanShiftUndoRequest(currentUndo.action),
          ),
        );
        setNotice("已撤销计划顺延。");
      }
      markShiftPreviewStale();
    } catch (operationError: unknown) {
      setError(normalizeCyclePlanError(operationError));
    } finally {
      setBusy(false);
      requestAnimationFrame(() => {
        if (focusTarget?.isConnected) {
          focusTarget.focus({ preventScroll: true });
        }
      });
    }
  };

  const closeWindow = () => {
    invalidateUndo();
    shiftPreviewRequestIdRef.current += 1;
    setShiftPreview(undefined);
    setOpenPlanId(undefined);
    setWindowMode("summary");
    setDraft(undefined);
    setInitialDraft(undefined);
  };

  const openCreate = (trigger: HTMLButtonElement) => {
    invalidateUndo();
    shiftPreviewRequestIdRef.current += 1;
    setShiftPreview(undefined);
    activeTriggerRef.current = trigger;
    const value = emptyDraft();
    setOpenPlanId(NEW_PLAN_ID);
    setWindowMode("edit");
    setInitialDraft(value);
    setDraft(value);
  };

  const openPlan = (
    overview: CyclePlanOverview,
    trigger: HTMLButtonElement,
  ) => {
    invalidateUndo();
    shiftPreviewRequestIdRef.current += 1;
    setShiftPreview(undefined);
    activeTriggerRef.current = trigger;
    setOpenPlanId(overview.plan.id);
    setWindowMode("summary");
    setDraft(undefined);
    setInitialDraft(undefined);
  };

  const startEdit = (value: Draft, baseline = value) => {
    setWindowMode("edit");
    setInitialDraft(baseline);
    setDraft(value);
  };

  const backToSummary = () => {
    shiftPreviewRequestIdRef.current += 1;
    setShiftPreview(undefined);
    setWindowMode("summary");
    setDraft(undefined);
    setInitialDraft(undefined);
  };

  const retryDashboard = () => {
    invalidateUndo();
    setDashboard(undefined);
    setError(undefined);
    setNotice("");
    setLoadVersion((current) => current + 1);
  };

  if (dashboard === undefined && error === undefined) {
    return (
      <section className="cycle-plan-page" aria-labelledby="cycle-plan-title">
        <PageHeader
          id="cycle-plan-title"
          title="计划"
          description="设置学习节奏，月历会自动生成。"
        />
        <PageStatus tone="loading" title="正在准备周期计划与月历…" />
      </section>
    );
  }

  if (dashboard === undefined && error !== undefined) {
    return (
      <section className="cycle-plan-page" aria-labelledby="cycle-plan-title">
        <PageHeader
          id="cycle-plan-title"
          title="计划"
          description="设置学习节奏，月历会自动生成。"
        />
        <PageStatus
          tone="error"
          title={error.message}
          action={
            <button type="button" onClick={retryDashboard}>
              重新读取
            </button>
          }
        >
          {error.action}
        </PageStatus>
      </section>
    );
  }

  if (dashboard === undefined) {
    return null;
  }

  return (
    <CyclePlanWorkspace
      dashboard={dashboard}
      today={today}
      selectedDate={selectedDate}
      month={month}
      busy={busy}
      notice={notice}
      error={error}
      openPlanId={openPlanId}
      windowMode={windowMode}
      draft={draft}
      initialDraft={initialDraft}
      shiftPreview={shiftPreview}
      undo={undo}
      planHeadingRef={planHeadingRef}
      activeTriggerRef={activeTriggerRef}
      shiftButtonRef={shiftButtonRef}
      shiftPreviewHeadingRef={shiftPreviewHeadingRef}
      undoButtonRef={undoButtonRef}
      itemActionRefs={itemActionRefs}
      run={run}
      openCreate={openCreate}
      openPlan={openPlan}
      closeWindow={closeWindow}
      startEdit={startEdit}
      backToSummary={backToSummary}
      openShiftPreview={openShiftPreview}
      cancelShiftPreview={cancelShiftPreview}
      refreshShiftPreview={refreshShiftPreview}
      confirmShiftPreview={confirmShiftPreview}
      setDraft={setDraft}
      setMonth={setMonth}
      setSelectedDate={setSelectedDate}
      setWindowMode={setWindowMode}
      updateCycleItemState={updateCycleItemState}
      undoLatestAction={() => void undoLatestAction()}
      saveCyclePlan={saveCyclePlan}
      archiveCyclePlan={archiveCyclePlan}
      setReviewRestWeekdays={setReviewRestWeekdays}
      getCyclePlanDashboard={getCyclePlanDashboard}
    />
  );
}
