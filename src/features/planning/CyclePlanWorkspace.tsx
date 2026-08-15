import { PageHeader } from "../../shared/components/PagePrimitives";
import type {
  CyclePlanCommandError,
  CyclePlanDashboard,
  CyclePlanItem,
  CyclePlanItemState,
  CyclePlanOverview,
  SaveCyclePlanInput,
} from "../../shared/tauri/cyclePlanClient";
import { CyclePlanCalendarWorkspace } from "./CyclePlanCalendarWorkspace";
import { CyclePlanDialog, CyclePlanOperationStatus } from "./CyclePlanDialog";
import {
  sameDraft,
  type CyclePlanDraft,
  type CyclePlanPanelWindowMode,
  type CyclePlanShiftPreviewState,
  type CyclePlanUndoState,
  NEW_PLAN_ID,
} from "./cyclePlanViewModel";

export interface CyclePlanWorkspaceProps {
  dashboard: CyclePlanDashboard;
  today: string;
  selectedDate: string;
  month: { year: number; month: number };
  busy: boolean;
  notice: string;
  error?: CyclePlanCommandError;
  openPlanId?: string;
  windowMode: CyclePlanPanelWindowMode;
  draft?: CyclePlanDraft;
  initialDraft?: CyclePlanDraft;
  shiftPreview?: CyclePlanShiftPreviewState;
  undo?: CyclePlanUndoState;
  planHeadingRef: React.RefObject<HTMLHeadingElement | null>;
  activeTriggerRef: React.RefObject<HTMLButtonElement | null>;
  shiftButtonRef: React.RefObject<HTMLButtonElement | null>;
  shiftPreviewHeadingRef: React.RefObject<HTMLHeadingElement | null>;
  undoButtonRef: React.RefObject<HTMLButtonElement | null>;
  itemActionRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  run(
    operation: () => Promise<CyclePlanDashboard>,
    success: string,
  ): Promise<boolean>;
  openCreate(trigger: HTMLButtonElement): void;
  openPlan(overview: CyclePlanOverview, trigger: HTMLButtonElement): void;
  closeWindow(): void;
  startEdit(value: CyclePlanDraft, baseline?: CyclePlanDraft): void;
  backToSummary(): void;
  openShiftPreview(planId: string): void;
  cancelShiftPreview(): void;
  refreshShiftPreview(): void;
  confirmShiftPreview(): Promise<void>;
  setDraft(value: CyclePlanDraft): void;
  setMonth(value: { year: number; month: number }): void;
  setSelectedDate(value: string): void;
  setWindowMode(value: CyclePlanPanelWindowMode): void;
  updateCycleItemState(
    item: CyclePlanItem,
    targetState: CyclePlanItemState,
    itemLabel: string,
    trigger: HTMLButtonElement,
  ): Promise<void>;
  undoLatestAction(): void;
  saveCyclePlan(request: SaveCyclePlanInput): Promise<CyclePlanDashboard>;
  archiveCyclePlan(
    planId: string,
    expectedUpdatedAt: number,
  ): Promise<CyclePlanDashboard>;
  setReviewRestWeekdays(values: number[], today: string): Promise<unknown>;
  getCyclePlanDashboard(): Promise<CyclePlanDashboard>;
}

export function CyclePlanWorkspace({
  dashboard,
  today,
  selectedDate,
  month,
  busy,
  notice,
  error,
  openPlanId,
  windowMode,
  draft,
  initialDraft,
  shiftPreview,
  undo,
  planHeadingRef,
  activeTriggerRef,
  shiftButtonRef,
  shiftPreviewHeadingRef,
  undoButtonRef,
  itemActionRefs,
  run,
  openCreate,
  openPlan,
  closeWindow,
  startEdit,
  backToSummary,
  openShiftPreview,
  cancelShiftPreview,
  refreshShiftPreview,
  confirmShiftPreview,
  setDraft,
  setMonth,
  setSelectedDate,
  setWindowMode,
  updateCycleItemState,
  undoLatestAction,
  saveCyclePlan,
  archiveCyclePlan,
  setReviewRestWeekdays,
  getCyclePlanDashboard,
}: CyclePlanWorkspaceProps) {
  const plans = dashboard.plans;
  const openOverview =
    openPlanId === undefined || openPlanId === NEW_PLAN_ID
      ? undefined
      : plans.find((overview) => overview.plan.id === openPlanId);
  const editingDirty =
    windowMode === "edit" &&
    draft !== undefined &&
    initialDraft !== undefined &&
    !sameDraft(draft, initialDraft);
  const operationStatus = (
    <CyclePlanOperationStatus
      error={error}
      notice={notice}
      undo={undo}
      busy={busy}
      undoButtonRef={undoButtonRef}
      onUndo={undoLatestAction}
    />
  );
  return (
    <section className="cycle-plan-page" aria-labelledby="cycle-plan-title">
      <PageHeader
        id="cycle-plan-title"
        title="计划"
        description="先看整月安排；只需设置数量和节奏，不必逐日添加任务。"
        actions={
          <button
            type="button"
            disabled={busy}
            onClick={(event) => openCreate(event.currentTarget)}
          >
            新建周期计划
          </button>
        }
      />
      {openPlanId === undefined ? operationStatus : null}
      {openPlanId === undefined ? null : (
        <CyclePlanDialog
          operationStatus={operationStatus}
          dashboard={dashboard}
          openPlanId={openPlanId}
          openOverview={openOverview}
          selectedDate={selectedDate}
          windowMode={windowMode}
          draft={draft}
          initialDraft={initialDraft}
          shiftPreview={shiftPreview}
          busy={busy}
          editingDirty={editingDirty}
          activeTriggerRef={activeTriggerRef}
          planHeadingRef={planHeadingRef}
          shiftButtonRef={shiftButtonRef}
          shiftPreviewHeadingRef={shiftPreviewHeadingRef}
          closeWindow={closeWindow}
          cancelShiftPreview={cancelShiftPreview}
          backToSummary={backToSummary}
          setDraft={setDraft}
          run={run}
          saveCyclePlan={saveCyclePlan}
          archiveCyclePlan={archiveCyclePlan}
          startEdit={startEdit}
          openShiftPreview={openShiftPreview}
          refreshShiftPreview={refreshShiftPreview}
          confirmShiftPreview={confirmShiftPreview}
          setWindowMode={setWindowMode}
        />
      )}
      <CyclePlanCalendarWorkspace
        dashboard={dashboard}
        today={today}
        selectedDate={selectedDate}
        month={month}
        busy={busy}
        planHeadingRef={planHeadingRef}
        itemActionRefs={itemActionRefs}
        openPlan={openPlan}
        setMonth={setMonth}
        setSelectedDate={setSelectedDate}
        updateCycleItemState={updateCycleItemState}
        run={run}
        setReviewRestWeekdays={setReviewRestWeekdays}
        getCyclePlanDashboard={getCyclePlanDashboard}
      />
    </section>
  );
}
