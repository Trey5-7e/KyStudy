import { useEffect, useRef, useState } from "react";

import "./today.css";

import {
  getCyclePlanDashboard,
  normalizeCyclePlanError,
  restoreCyclePlanItemState,
  setCyclePlanItemState,
  type CyclePlanCommandError,
  type CyclePlanDashboard,
  type CyclePlanItem,
  type CyclePlanItemState,
} from "../../shared/tauri/cyclePlanClient";

import { cyclePlanItemTransitionNotice } from "../planning/cyclePlanItemActions";
import {
  getReviewSchemeDashboard,
  normalizeReviewSchemeError,
  prepareReviewSchemeQueues,
  type ReviewSchemeCommandError,
  type ReviewSchemeDashboard,
} from "../../shared/tauri/reviewSchemeClient";
import {
  listStudyPlans,
  normalizePlanningError,
  type StudyPlanBundle,
} from "../../shared/tauri/planningClient";
import type { ResourceCommandError } from "../../shared/tauri/resourceClient";
import { localDateForTimezone } from "../../shared/tauri/scheduleClient";
import {
  getWorkspaceStatus,
  normalizeWorkspaceCommandError,
  type WorkspaceCommandError,
} from "../../shared/tauri/workspaceClient";
import { selectUpcomingExam, type ExamCountdown } from "./todayCountdownModel";
import {
  CYCLE_PLAN_UNDO_WINDOW_MS,
  createCyclePlanUndoAction,
  createCyclePlanUndoRequest,
  cyclePlanUndoIdentity,
  isCyclePlanUndoExpired,
  type CyclePlanUndoAction,
} from "../planning/cyclePlanUndo";
import { TodayExamEditorDialog } from "./TodayExamEditorDialog";
import { TodayActionFeedback } from "./TodayActionFeedback";
import { TodayCyclePlanSection } from "./TodayCyclePlanSection";
import { TodayFocusHeader } from "./TodayFocusHeader";
import { TodayNextAction } from "./TodayNextAction";
import { TodayOverviewStatus } from "./TodayOverviewStatus";
import { TodayProgressSection } from "./TodayProgressSection";
import { TodaySupportSections } from "./TodaySupportSections";
import { summarizeTodayOverview } from "./todayOverviewParts";
import { loadPaperDraft } from "../workbook/paperSetupPreferences";

interface TodayOverviewPanelProps {
  onOpenPlan(): void;
  onOpenReview(openWindow: boolean): void;
  onOpenSettings(): void;
  onOpenWorkbook(): void;
  onOpenPaper(): void;
}

interface CyclePlanUndoState {
  action: CyclePlanUndoAction;
  itemLabel: string;
}

export interface ReadyOverview {
  date: string;
  review?: ReviewSchemeDashboard;
  reviewError?: ReviewSchemeCommandError;
  cyclePlans?: CyclePlanDashboard;
  cyclePlanError?: CyclePlanCommandError;
  exam?: ExamCountdown;
  activePlan?: StudyPlanBundle;
  examPlan?: StudyPlanBundle;
  plans: StudyPlanBundle[];
  examError?: ResourceCommandError;
}

type OverviewState =
  | { kind: "loading" }
  | { kind: "missing-workspace" }
  | { kind: "ready"; overview: ReadyOverview }
  | { kind: "error"; error: WorkspaceCommandError };

type OverviewLoadResults = readonly [
  PromiseSettledResult<ReviewSchemeDashboard>,
  PromiseSettledResult<CyclePlanDashboard>,
  PromiseSettledResult<StudyPlanBundle[]>,
];

export function mergeOverviewResults(
  date: string,
  results: OverviewLoadResults,
): ReadyOverview {
  const [reviewResult, cyclePlanResult, plansResult] = results;
  const activePlan =
    plansResult.status === "fulfilled"
      ? plansResult.value.find(({ plan }) => plan.status === "active")
      : undefined;
  const plans = plansResult.status === "fulfilled" ? plansResult.value : [];
  const exam =
    plansResult.status === "fulfilled"
      ? selectUpcomingExam(
          plansResult.value.map(({ plan }) => plan),
          date,
        )
      : undefined;
  return {
    date,
    plans,
    ...(reviewResult.status === "fulfilled"
      ? { review: reviewResult.value }
      : { reviewError: normalizeReviewSchemeError(reviewResult.reason) }),
    ...(cyclePlanResult.status === "fulfilled"
      ? { cyclePlans: cyclePlanResult.value }
      : {
          cyclePlanError: normalizeCyclePlanError(cyclePlanResult.reason),
        }),
    ...(plansResult.status === "fulfilled"
      ? {
          activePlan,
          exam,
          examPlan:
            exam === undefined
              ? undefined
              : plansResult.value.find(({ plan }) => plan.id === exam.planId),
        }
      : { examError: normalizePlanningError(plansResult.reason) }),
  };
}

async function loadOverview(): Promise<OverviewState> {
  try {
    const workspace = await getWorkspaceStatus();
    if (workspace === null) {
      return { kind: "missing-workspace" };
    }
    const date = localDateForTimezone(new Date(), workspace.timezone);
    const [reviewResult, cyclePlanResult, plansResult] =
      await Promise.allSettled([
        getReviewSchemeDashboard(date),
        getCyclePlanDashboard(),
        listStudyPlans(),
      ]);
    return {
      kind: "ready",
      overview: mergeOverviewResults(date, [
        reviewResult,
        cyclePlanResult,
        plansResult,
      ]),
    };
  } catch (error: unknown) {
    return {
      kind: "error",
      error: normalizeWorkspaceCommandError(error),
    };
  }
}

export function TodayOverviewPanel({
  onOpenPlan,
  onOpenReview,
  onOpenSettings,
  onOpenWorkbook,
  onOpenPaper,
}: TodayOverviewPanelProps) {
  const [state, setState] = useState<OverviewState>({ kind: "loading" });
  const [busyTaskId, setBusyTaskId] = useState<string>();
  const [actionError, setActionError] = useState<
    CyclePlanCommandError | ReviewSchemeCommandError
  >();
  const [notice, setNotice] = useState<string>();
  const [examEditorOpen, setExamEditorOpen] = useState(false);
  const [hasSavedPaperDraft] = useState(() => loadPaperDraft() !== undefined);
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const loadRequestIdRef = useRef(0);
  const lastItemTriggerRef = useRef<HTMLButtonElement>(null);
  const itemActionRefs = useRef(new Map<string, HTMLButtonElement>());
  const [undo, setUndo] = useState<CyclePlanUndoState>();
  const undoIdentity =
    undo === undefined ? undefined : cyclePlanUndoIdentity(undo.action);

  useEffect(() => {
    if (undo === undefined || undoIdentity === undefined) {
      return;
    }
    const delay = Math.min(
      CYCLE_PLAN_UNDO_WINDOW_MS,
      Math.max(0, undo.action.expiresAt - Date.now()),
    );
    const timeoutId = window.setTimeout(() => {
      if (!isCyclePlanUndoExpired(undo.action)) {
        return;
      }
      const wasUndoFocused = document.activeElement === undoButtonRef.current;
      const focusTarget = lastItemTriggerRef.current;
      setUndo((current) =>
        current === undefined ||
        cyclePlanUndoIdentity(current.action) !== undoIdentity
          ? current
          : undefined,
      );
      if (wasUndoFocused && focusTarget?.isConnected) {
        focusTarget.focus({ preventScroll: true });
      }
    }, delay);
    return () => window.clearTimeout(timeoutId);
  }, [undo, undoIdentity]);

  const invalidateUndo = () => {
    setUndo(undefined);
  };

  const registerItemAction = (
    itemId: string,
    node: HTMLButtonElement | null,
  ) => {
    if (node === null) {
      itemActionRefs.current.delete(itemId);
    } else {
      itemActionRefs.current.set(itemId, node);
    }
  };

  const refresh = async () => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    invalidateUndo();
    setState({ kind: "loading" });
    setActionError(undefined);
    setNotice(undefined);
    const loaded = await loadOverview();
    if (loadRequestIdRef.current === requestId) {
      setState(loaded);
    }
  };

  useEffect(() => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    void loadOverview().then((loaded) => {
      if (loadRequestIdRef.current === requestId) {
        setState(loaded);
      }
    });
    return () => {
      if (loadRequestIdRef.current === requestId) {
        loadRequestIdRef.current += 1;
      }
    };
  }, []);

  const updateCycleItemState = async (
    item: CyclePlanItem,
    targetState: CyclePlanItemState,
    itemLabel: string,
    trigger: HTMLButtonElement,
  ) => {
    if (state.kind !== "ready") {
      return;
    }
    invalidateUndo();
    lastItemTriggerRef.current = trigger;
    setBusyTaskId(item.id);
    setActionError(undefined);
    setNotice(undefined);
    try {
      const mutation = await setCyclePlanItemState({
        itemId: item.id,
        targetState,
        expectedUpdatedAt: item.updatedAt,
      });
      setState((current) =>
        current.kind === "ready"
          ? {
              kind: "ready",
              overview: { ...current.overview, cyclePlans: mutation.dashboard },
            }
          : current,
      );
      setUndo({
        action: createCyclePlanUndoAction(item, mutation),
        itemLabel,
      });
      setNotice(cyclePlanItemTransitionNotice(item.state, targetState));
      requestAnimationFrame(() => {
        lastItemTriggerRef.current =
          itemActionRefs.current.get(item.id) ?? null;
      });
    } catch (error: unknown) {
      setActionError(normalizeCyclePlanError(error));
    } finally {
      setBusyTaskId(undefined);
    }
  };

  const undoCycleItem = async () => {
    if (undo === undefined) {
      return;
    }
    const currentUndo = undo;
    invalidateUndo();
    if (isCyclePlanUndoExpired(currentUndo.action)) {
      return;
    }
    setBusyTaskId(currentUndo.action.itemId);
    setActionError(undefined);
    setNotice(undefined);
    try {
      const cyclePlans = await restoreCyclePlanItemState(
        createCyclePlanUndoRequest(currentUndo.action),
      );
      setState((current) =>
        current.kind === "ready"
          ? {
              kind: "ready",
              overview: { ...current.overview, cyclePlans },
            }
          : current,
      );
      setNotice(`已撤销${currentUndo.itemLabel}的事项状态。`);
    } catch (error: unknown) {
      setActionError(normalizeCyclePlanError(error));
    } finally {
      setBusyTaskId(undefined);
    }
  };

  const startTodayReview = async (openWindow: boolean) => {
    if (state.kind !== "ready" || state.overview.review === undefined) {
      onOpenReview(false);
      return;
    }
    invalidateUndo();
    setBusyTaskId("today-review");
    setActionError(undefined);
    setNotice(undefined);
    try {
      const review = await prepareReviewSchemeQueues(
        state.overview.date,
        state.overview.review,
      );
      setState((current) =>
        current.kind === "ready"
          ? {
              kind: "ready",
              overview: { ...current.overview, review },
            }
          : current,
      );
      onOpenReview(openWindow);
    } catch (error: unknown) {
      setActionError(normalizeReviewSchemeError(error));
    } finally {
      setBusyTaskId(undefined);
    }
  };

  if (
    state.kind === "loading" ||
    state.kind === "missing-workspace" ||
    state.kind === "error"
  ) {
    return (
      <TodayOverviewStatus
        kind={state.kind}
        error={state.kind === "error" ? state.error : undefined}
        onOpenSettings={onOpenSettings}
        onRetry={() => void refresh()}
      />
    );
  }

  const review = state.overview.review;
  const overviewSummary = summarizeTodayOverview(
    state.overview.cyclePlans,
    state.overview.date,
    review,
    state.overview.activePlan !== undefined,
  );
  const {
    cycle: cycleSummary,
    review: reviewSummary,
    nextCycle,
    nextCycleAction,
    nextCycleLabel,
    reviewHasWork,
    nextActionKind,
    progress,
  } = overviewSummary;
  const {
    activeSchemes,
    completed: reviewCompleted,
    target: reviewTarget,
    generated: generatedSchemes,
    remaining: reviewRemaining,
    finished: reviewFinished,
    restDay: reviewRestDay,
    tone: reviewTone,
  } = reviewSummary;

  return (
    <section
      className="today-overview today-focus-view"
      aria-labelledby="today-title"
      aria-busy={busyTaskId !== undefined}
    >
      {examEditorOpen ? (
        <TodayExamEditorDialog
          activePlan={state.overview.examPlan ?? state.overview.activePlan}
          today={state.overview.date}
          onClose={() => setExamEditorOpen(false)}
          onSaveStart={invalidateUndo}
          onSaved={(activePlan) => {
            invalidateUndo();
            setState((current) =>
              current.kind === "ready"
                ? {
                    kind: "ready",
                    overview: (() => {
                      const existing = current.overview.plans.some(
                        (bundle) => bundle.plan.id === activePlan.plan.id,
                      );
                      const plans = existing
                        ? current.overview.plans.map((bundle) =>
                            bundle.plan.id === activePlan.plan.id
                              ? activePlan
                              : bundle,
                          )
                        : [...current.overview.plans, activePlan];
                      const exam = selectUpcomingExam(
                        plans.map(({ plan }) => plan),
                        current.overview.date,
                      );
                      return {
                        ...current.overview,
                        plans,
                        activePlan: plans.find(
                          ({ plan }) => plan.status === "active",
                        ),
                        examPlan:
                          exam === undefined
                            ? undefined
                            : plans.find(({ plan }) => plan.id === exam.planId),
                        exam,
                        examError: undefined,
                      };
                    })(),
                  }
                : current,
            );
            setNotice("考试信息已保存。");
            setExamEditorOpen(false);
          }}
        />
      ) : null}

      <TodayFocusHeader date={state.overview.date} exam={state.overview.exam} />

      <TodayActionFeedback
        actionError={actionError}
        notice={notice}
        undo={undo}
        undoButtonRef={undoButtonRef}
        busyTaskId={busyTaskId}
        onUndo={() => void undoCycleItem()}
      />

      <TodayNextAction
        kind={nextActionKind}
        reviewHasWork={reviewHasWork}
        generatedSchemes={generatedSchemes}
        reviewRemaining={reviewRemaining}
        reviewRestDay={reviewRestDay}
        reviewFinished={reviewFinished}
        nextCycle={nextCycle}
        nextCycleAction={nextCycleAction}
        nextCycleLabel={nextCycleLabel}
        busyTaskId={busyTaskId}
        registerItemAction={registerItemAction}
        onStartReview={(openWindow) => void startTodayReview(openWindow)}
        onUpdateCycleItemState={(item, targetState, itemLabel, trigger) =>
          void updateCycleItemState(item, targetState, itemLabel, trigger)
        }
        onOpenPlan={onOpenPlan}
        onOpenWorkbook={onOpenWorkbook}
      />

      <TodayProgressSection
        progressCompleted={progress.completed}
        progressTotal={progress.total}
        progressPercent={progress.percent}
        skippedCycles={cycleSummary.skippedCount}
      />

      <div className="today-secondary-layout">
        <TodayCyclePlanSection
          items={cycleSummary.items}
          nextCycleId={nextCycle?.item.id}
          cyclePlanError={state.overview.cyclePlanError}
          busyTaskId={busyTaskId}
          onOpenPlan={onOpenPlan}
          registerItemAction={registerItemAction}
          onUpdateCycleItemState={(item, targetState, itemLabel, trigger) =>
            void updateCycleItemState(item, targetState, itemLabel, trigger)
          }
        />

        <TodaySupportSections
          review={review}
          activeSchemes={activeSchemes}
          reviewError={state.overview.reviewError}
          reviewCompleted={reviewCompleted}
          reviewTarget={reviewTarget}
          reviewRemaining={reviewRemaining}
          generatedSchemes={generatedSchemes}
          reviewFinished={reviewFinished}
          reviewRestDay={reviewRestDay}
          reviewTone={reviewTone}
          exam={state.overview.exam}
          examError={state.overview.examError}
          hasActivePlan={state.overview.activePlan !== undefined}
          hasSavedPaperDraft={hasSavedPaperDraft}
          busyTaskId={busyTaskId}
          onRefresh={() => void refresh()}
          onOpenWorkbook={onOpenWorkbook}
          onOpenPaper={onOpenPaper}
          onEditExam={() => setExamEditorOpen(true)}
          onStartReview={(openWindow) => void startTodayReview(openWindow)}
        />
      </div>
    </section>
  );
}
