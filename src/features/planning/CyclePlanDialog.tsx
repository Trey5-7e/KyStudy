import type { ReactNode, RefObject } from "react";

import { EditorDialog } from "../../shared/components/EditorDialog";
import { PageEmpty, PageStatus } from "../../shared/components/PagePrimitives";
import type {
  CyclePlanCommandError,
  CyclePlanDashboard,
  CyclePlanOverview,
  CyclePlanShiftPreview,
  SaveCyclePlanInput,
} from "../../shared/tauri/cyclePlanClient";
import { CyclePlanEditor } from "./CyclePlanEditor";
import {
  canConfirmCyclePlanShiftPreview,
  cyclePlanShiftDeadlineWarning,
  cyclePlanShiftRestDaysLabel,
} from "./cyclePlanShiftPreview";
import {
  cyclePlanProgressLabel,
  cyclePlanVisibilityLabel,
  cyclePlanVisibilityStatus,
  type CyclePlanWindowMode,
} from "./cyclePlanWindowModel";
import {
  fromOverview,
  formatShortDate,
  toInput,
  type CyclePlanDraft,
  type CyclePlanPanelWindowMode,
  type CyclePlanShiftPreviewState,
  type CyclePlanUndoState,
  NEW_PLAN_ID,
} from "./cyclePlanViewModel";

export function CyclePlanOperationStatus({
  error,
  notice,
  undo,
  busy,
  undoButtonRef,
  onUndo,
}: {
  error?: CyclePlanCommandError;
  notice: string;
  undo?: CyclePlanUndoState;
  busy: boolean;
  undoButtonRef: RefObject<HTMLButtonElement | null>;
  onUndo(): void;
}) {
  return (
    <>
      {error === undefined ? null : (
        <PageStatus tone="error" title={error.message}>
          {error.action}
        </PageStatus>
      )}
      {notice === "" ? null : (
        <PageStatus
          tone="success"
          action={
            undo === undefined ? undefined : (
              <button
                ref={undoButtonRef}
                type="button"
                disabled={busy}
                aria-label={
                  undo.kind === "shift" ? "撤销顺延" : `撤销${undo.itemLabel}`
                }
                onClick={onUndo}
              >
                {undo.kind === "shift" ? "撤销顺延" : "撤销"}
              </button>
            )
          }
        >
          {notice}
        </PageStatus>
      )}
    </>
  );
}

function CyclePlanShiftPreviewView({
  state,
  busy,
  headingRef,
  onCancel,
  onRefresh,
  onConfirm,
}: {
  state: CyclePlanShiftPreviewState;
  busy: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onCancel(): void;
  onRefresh(): void;
  onConfirm(): void;
}) {
  const preview = previewFromState(state);
  const warning =
    preview === undefined ? undefined : cyclePlanShiftDeadlineWarning(preview);
  const confirmable =
    preview !== undefined &&
    canConfirmCyclePlanShiftPreview(preview) &&
    state.status === "ready";

  return (
    <div className="cycle-plan-management">
      <section
        className="cycle-plan-management-summary"
        aria-labelledby="cycle-plan-shift-preview-title"
      >
        <h3 ref={headingRef} id="cycle-plan-shift-preview-title" tabIndex={-1}>
          顺延预览
        </h3>
        {preview === undefined ? (
          <p>起算日：{formatShortDate(state.request.fromDate)}</p>
        ) : (
          <dl className="cycle-plan-management-details">
            <div>
              <dt>起算日</dt>
              <dd>{formatShortDate(preview.fromDate)}</dd>
            </div>
            <div>
              <dt>影响事项</dt>
              <dd>{preview.affectedItemCount} 项</dd>
            </div>
            <div>
              <dt>当前预计完成</dt>
              <dd>{formatShortDate(preview.currentEstimatedEndDate)}</dd>
            </div>
            <div>
              <dt>顺延后预计完成</dt>
              <dd>{formatShortDate(preview.newEstimatedEndDate)}</dd>
            </div>
            <div>
              <dt>截止日期</dt>
              <dd>{formatShortDate(preview.deadline)}</dd>
            </div>
          </dl>
        )}
        {preview === undefined ? null : (
          <p>{cyclePlanShiftRestDaysLabel(preview)}</p>
        )}
      </section>

      {state.status === "loading" ? (
        <PageStatus tone="loading" title="正在生成顺延预览">
          计划尚未写入，请稍候核对新的日期。
        </PageStatus>
      ) : null}
      {state.status === "stale" || state.status === "error" ? (
        <PageStatus tone="error" title={state.error.message}>
          {state.error.action}
        </PageStatus>
      ) : null}
      {state.status === "empty" ? (
        <PageEmpty
          headingLevel={3}
          announce
          title="没有可顺延的未完成事项"
          description="当前起算日之后没有需要调整的计划事项。"
        />
      ) : null}
      {warning === undefined ? null : (
        <PageStatus tone="warning" title="顺延后将超过截止日期">
          {warning}
        </PageStatus>
      )}

      <div className="cycle-plan-management-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || state.status === "loading"}
          onClick={onRefresh}
        >
          刷新预览
        </button>
        <button
          type="button"
          disabled={busy || !confirmable}
          onClick={onConfirm}
        >
          {state.status === "confirming" ? "正在确认…" : "确认顺延"}
        </button>
      </div>
    </div>
  );
}

function previewFromState(
  state: CyclePlanShiftPreviewState,
): CyclePlanShiftPreview | undefined {
  return state.preview;
}

function CyclePlanManagement({
  overview,
  mode,
  busy,
  selectedDate,
  shiftButtonRef,
  onEdit,
  onToggleCalendar,
  onShift,
  onUseFaster,
  onUseSmaller,
  onAskArchive,
  onCancelArchive,
  onArchive,
}: {
  overview: CyclePlanOverview;
  mode: CyclePlanWindowMode;
  busy: boolean;
  selectedDate: string;
  shiftButtonRef: RefObject<HTMLButtonElement | null>;
  onEdit(): void;
  onToggleCalendar(): Promise<boolean>;
  onShift(): void;
  onUseFaster(): void;
  onUseSmaller(): void;
  onAskArchive(): void;
  onCancelArchive(): void;
  onArchive(): Promise<void>;
}) {
  const plan = overview.plan;
  if (mode === "archive") {
    return (
      <section
        className="cycle-plan-archive-confirm"
        aria-labelledby="cycle-plan-archive-title"
        aria-describedby="cycle-plan-archive-description"
        role="alert"
      >
        <p className="section-label">确认操作</p>
        <h3 id="cycle-plan-archive-title">归档“{plan.name}”？</h3>
        <p id="cycle-plan-archive-description">
          归档后会从计划列表和月历移除，但历史进度和学习记录仍会保留。
        </p>
        <div className="cycle-plan-management-actions">
          <button
            type="button"
            className="danger-button"
            disabled={busy}
            onClick={() => void onArchive()}
          >
            确认归档
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onCancelArchive}
          >
            返回计划
          </button>
        </div>
        <p
          className="cycle-plan-window-status"
          role="status"
          aria-live="polite"
          aria-busy={busy}
        >
          {busy ? "正在归档…" : "归档前请确认这项操作。"}
        </p>
      </section>
    );
  }

  const nextItem = overview.items.find((item) => item.state === "pending");
  return (
    <div className="cycle-plan-management">
      <section
        className="cycle-plan-management-summary"
        aria-labelledby="cycle-plan-management-title"
      >
        <header className="cycle-plan-management-heading">
          <div>
            <p className="section-label">计划摘要</p>
            <h3 id="cycle-plan-management-title">{plan.name}</h3>
          </div>
          <strong aria-label={`已完成 ${overview.progressPercent}%`}>
            {overview.progressPercent}%
          </strong>
        </header>
        <progress
          value={overview.completedCount}
          max={plan.totalUnits}
          aria-label={`${plan.name} 完成进度`}
        >
          {overview.progressPercent}%
        </progress>
        <p className="cycle-plan-management-progress">
          {cyclePlanProgressLabel(overview)}，已跳过 {overview.skippedCount}{" "}
          项，预计 {formatShortDate(overview.estimatedEndDate)}
          完成
        </p>
        <dl className="cycle-plan-management-dates">
          <div>
            <dt>计划日期</dt>
            <dd>
              {formatShortDate(plan.startDate)} 至{" "}
              {formatShortDate(plan.deadline)}
            </dd>
          </div>
          <div>
            <dt>节奏</dt>
            <dd>
              每 {plan.studyDaysPerUnit} 个学习日 1 {plan.unitLabel}
            </dd>
          </div>
          <div>
            <dt>下一项</dt>
            <dd>
              {nextItem === undefined
                ? overview.completedCount === plan.totalUnits
                  ? "已完成"
                  : "没有待完成事项"
                : `第 ${nextItem.unitIndex} ${plan.unitLabel} · ${formatShortDate(nextItem.plannedStartDate)}`}
            </dd>
          </div>
        </dl>
        <div className="cycle-plan-management-visibility">
          <div>
            <strong>月历可见性</strong>
            <span role="status" aria-live="polite">
              {cyclePlanVisibilityStatus(plan.calendarVisible)}
            </span>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            aria-pressed={plan.calendarVisible}
            onClick={() => void onToggleCalendar()}
          >
            {cyclePlanVisibilityLabel(plan.calendarVisible)}
          </button>
        </div>
      </section>

      {overview.exceedsDeadline ? (
        <div className="cycle-overdue" role="status" aria-live="polite">
          <strong>
            按当前节奏会超过截止日期 {formatShortDate(plan.deadline)}
          </strong>
          <p>可以保持原计划，也可以选择建议后再确认重新规划。</p>
          <div>
            {overview.recommendedStudyDaysPerUnit === undefined ? null : (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={onUseFaster}
              >
                改为每 {overview.recommendedStudyDaysPerUnit} 个学习日
              </button>
            )}
            {overview.recommendedTotalUnits === undefined ? null : (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={onUseSmaller}
              >
                减少为 {overview.recommendedTotalUnits} {plan.unitLabel}
              </button>
            )}
          </div>
        </div>
      ) : null}

      <div className="cycle-plan-management-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={onEdit}
        >
          编辑规则
        </button>
        <button
          ref={shiftButtonRef}
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={onShift}
        >
          从 {formatShortDate(selectedDate)} 后顺延 1 个学习日
        </button>
        <button
          type="button"
          className="danger-button"
          disabled={busy}
          onClick={onAskArchive}
        >
          归档计划
        </button>
      </div>
      <p
        className="cycle-plan-window-status"
        role="status"
        aria-live="polite"
        aria-busy={busy}
      >
        {busy ? "正在更新计划…" : "计划详情已加载。"}
      </p>
    </div>
  );
}

export interface CyclePlanDialogProps {
  operationStatus: ReactNode;
  dashboard: CyclePlanDashboard;
  openPlanId: string;
  openOverview?: CyclePlanOverview;
  selectedDate: string;
  windowMode: CyclePlanPanelWindowMode;
  draft?: CyclePlanDraft;
  initialDraft?: CyclePlanDraft;
  shiftPreview?: CyclePlanShiftPreviewState;
  busy: boolean;
  editingDirty: boolean;
  activeTriggerRef: RefObject<HTMLButtonElement | null>;
  planHeadingRef: RefObject<HTMLHeadingElement | null>;
  shiftButtonRef: RefObject<HTMLButtonElement | null>;
  shiftPreviewHeadingRef: RefObject<HTMLHeadingElement | null>;
  closeWindow(): void;
  cancelShiftPreview(): void;
  backToSummary(): void;
  setDraft(value: CyclePlanDraft): void;
  run(
    operation: () => Promise<CyclePlanDashboard>,
    success: string,
  ): Promise<boolean>;
  saveCyclePlan(request: SaveCyclePlanInput): Promise<CyclePlanDashboard>;
  archiveCyclePlan(
    planId: string,
    expectedUpdatedAt: number,
  ): Promise<CyclePlanDashboard>;
  startEdit(value: CyclePlanDraft, baseline?: CyclePlanDraft): void;
  openShiftPreview(planId: string): void;
  refreshShiftPreview(): void;
  confirmShiftPreview(): Promise<void>;
  setWindowMode(value: CyclePlanPanelWindowMode): void;
}

export function CyclePlanDialog({
  operationStatus,
  dashboard,
  openPlanId,
  openOverview,
  selectedDate,
  windowMode,
  draft,
  initialDraft,
  shiftPreview,
  busy,
  editingDirty,
  activeTriggerRef,
  planHeadingRef,
  shiftButtonRef,
  shiftPreviewHeadingRef,
  closeWindow,
  cancelShiftPreview,
  backToSummary,
  setDraft,
  run,
  saveCyclePlan,
  archiveCyclePlan,
  startEdit,
  openShiftPreview,
  refreshShiftPreview,
  confirmShiftPreview,
  setWindowMode,
}: CyclePlanDialogProps) {
  return (
    <EditorDialog
      title={
        openPlanId === NEW_PLAN_ID
          ? "新建周期计划"
          : windowMode === "shift-preview"
            ? "预览计划顺延"
            : windowMode === "edit"
              ? "编辑周期计划"
              : windowMode === "archive"
                ? `归档计划：${openOverview?.plan.name ?? "周期计划"}`
                : `${openOverview?.plan.name ?? "周期计划"} · 计划详情`
      }
      description={
        openPlanId === NEW_PLAN_ID || windowMode === "edit"
          ? "填写目标和节奏，KyStudy 自动生成全部学习日期。"
          : windowMode === "shift-preview"
            ? "确认前不会修改计划；请先核对新的完成日期。"
            : "查看进度、日期和月历可见性，并在此窗口维护计划。"
      }
      dirty={editingDirty}
      onRequestClose={closeWindow}
      onRequestBack={
        windowMode === "shift-preview"
          ? cancelShiftPreview
          : windowMode === "edit" && openPlanId !== NEW_PLAN_ID
            ? backToSummary
            : undefined
      }
      backLabel="返回计划"
      backRequiresConfirmation={windowMode !== "shift-preview"}
      closeDisabled={busy}
      returnFocusRef={activeTriggerRef}
      fallbackFocusRef={planHeadingRef}
      size="large"
    >
      {operationStatus}
      {openPlanId === NEW_PLAN_ID &&
      draft !== undefined &&
      initialDraft !== undefined ? (
        <CyclePlanEditor
          draft={draft}
          restWeekdays={dashboard?.restWeekdays ?? []}
          busy={busy}
          onChange={setDraft}
          onSave={async (value) => {
            const saved = await run(
              () => saveCyclePlan(toInput(value)),
              value.planId === undefined
                ? "周期计划已生成。"
                : "周期计划已重新排好。",
            );
            if (saved) {
              closeWindow();
            }
          }}
        />
      ) : openOverview === undefined ? null : windowMode === "shift-preview" ? (
        shiftPreview === undefined ? null : (
          <CyclePlanShiftPreviewView
            state={shiftPreview}
            busy={busy}
            headingRef={shiftPreviewHeadingRef}
            onCancel={cancelShiftPreview}
            onRefresh={refreshShiftPreview}
            onConfirm={() => void confirmShiftPreview()}
          />
        )
      ) : windowMode === "edit" ? (
        draft === undefined || initialDraft === undefined ? null : (
          <CyclePlanEditor
            draft={draft}
            restWeekdays={dashboard?.restWeekdays ?? []}
            busy={busy}
            onChange={setDraft}
            onSave={async (value) => {
              const saved = await run(
                () => saveCyclePlan(toInput(value)),
                "周期计划已重新排好。",
              );
              if (saved) {
                closeWindow();
              }
            }}
          />
        )
      ) : (
        <CyclePlanManagement
          overview={openOverview}
          mode={windowMode}
          busy={busy}
          selectedDate={selectedDate}
          shiftButtonRef={shiftButtonRef}
          onEdit={() => startEdit(fromOverview(openOverview))}
          onToggleCalendar={() =>
            run(
              () =>
                saveCyclePlan({
                  ...toInput(fromOverview(openOverview)),
                  expectedUpdatedAt: openOverview.plan.updatedAt,
                  calendarVisible: !openOverview.plan.calendarVisible,
                }),
              openOverview.plan.calendarVisible
                ? "已从月历隐藏。"
                : "已显示在月历。",
            )
          }
          onShift={() => openShiftPreview(openOverview.plan.id)}
          onUseFaster={() =>
            startEdit(
              {
                ...fromOverview(openOverview),
                studyDaysPerUnit: String(
                  openOverview.recommendedStudyDaysPerUnit ?? 1,
                ),
              },
              fromOverview(openOverview),
            )
          }
          onUseSmaller={() =>
            startEdit(
              {
                ...fromOverview(openOverview),
                totalUnits: String(
                  openOverview.recommendedTotalUnits ??
                    openOverview.plan.totalUnits,
                ),
              },
              fromOverview(openOverview),
            )
          }
          onAskArchive={() => setWindowMode("archive")}
          onCancelArchive={backToSummary}
          onArchive={async () => {
            const archived = await run(
              () =>
                archiveCyclePlan(
                  openOverview.plan.id,
                  openOverview.plan.updatedAt,
                ),
              "周期计划已归档，历史数据仍保留。",
            );
            if (archived) {
              closeWindow();
            }
          }}
        />
      )}
    </EditorDialog>
  );
}
