import { useEffect, useState } from "react";

import {
  getPlanExecutionProgress,
  normalizePlanProgressError,
  type PlanExecutionProgress,
  type PlanProgressSummary,
} from "../../shared/tauri/planProgressClient";
import {
  localDateForTimezone,
  type ScheduleCommandError,
} from "../../shared/tauri/scheduleClient";

type ProgressState =
  | { kind: "loading"; requestKey: string }
  | {
      kind: "ready";
      requestKey: string;
      progress: PlanExecutionProgress;
    }
  | { kind: "error"; requestKey: string; error: ScheduleCommandError };

interface PlanProgressPanelProps {
  planId: string;
  timezone: string;
  scopeVersion: string;
  refreshToken: number;
  onOpenSchedule(): void;
}

export function PlanProgressPanel({
  planId,
  timezone,
  scopeVersion,
  refreshToken,
  onOpenSchedule,
}: PlanProgressPanelProps) {
  const requestKey = JSON.stringify([
    planId,
    timezone,
    scopeVersion,
    refreshToken,
  ]);
  const [state, setState] = useState<ProgressState>({
    kind: "loading",
    requestKey,
  });
  const currentState: ProgressState =
    state.requestKey === requestKey ? state : { kind: "loading", requestKey };

  useEffect(() => {
    let active = true;
    const today = localDateForTimezone(new Date(), timezone);
    void getPlanExecutionProgress(planId, today).then(
      (progress) => {
        if (active) {
          setState({ kind: "ready", requestKey, progress });
        }
      },
      (error: unknown) => {
        if (active) {
          setState({
            kind: "error",
            requestKey,
            error: normalizePlanProgressError(error),
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [planId, requestKey, timezone]);

  return (
    <section
      className="plan-subsection plan-progress"
      aria-labelledby="plan-progress-title"
    >
      <div className="plan-progress-heading">
        <h3 id="plan-progress-title">执行进度</h3>
        <button
          type="button"
          className="secondary-button"
          onClick={onOpenSchedule}
        >
          查看日程
        </button>
      </div>

      {currentState.kind === "loading" ? (
        <p className="planning-note">正在统计计划执行记录…</p>
      ) : currentState.kind === "error" ? (
        <div className="error-detail" role="alert">
          <strong>{currentState.error.message}</strong>
          <p>{currentState.error.action}</p>
        </div>
      ) : (
        <ProgressContent progress={currentState.progress} />
      )}
    </section>
  );
}

function ProgressContent({ progress }: { progress: PlanExecutionProgress }) {
  const summary = progress.summary;
  return (
    <>
      <dl className="plan-progress-summary">
        <div>
          <dt>完成率</dt>
          <dd>{percentLabel(summary)}</dd>
          <small>
            已完成 {summary.completedTaskCount} / 有效{" "}
            {summary.effectiveTaskCount}
          </small>
        </div>
        <div>
          <dt>待完成</dt>
          <dd>{summary.remainingTaskCount}</dd>
          <small
            className={
              summary.overdueTaskCount > 0 ? "progress-overdue" : undefined
            }
          >
            逾期 {summary.overdueTaskCount}
          </small>
        </div>
        <div>
          <dt>计划投入</dt>
          <dd>{minutesLabel(summary.plannedMinutes)}</dd>
          <small>有效任务</small>
        </div>
        <div>
          <dt>实际投入</dt>
          <dd>{minutesLabel(summary.actualMinutes)}</dd>
          <small>真实学习记录</small>
        </div>
      </dl>

      {progress.stages.length === 0 ? (
        <p className="planning-note">这份计划还没有阶段。</p>
      ) : (
        <ol className="plan-progress-stages">
          {progress.stages.map((stage) => (
            <li key={stage.stageId}>
              <div className="plan-progress-stage-heading">
                <div>
                  <strong>{stage.stageTitle}</strong>
                  <time>
                    {stage.startDate} 至 {stage.endDate}
                  </time>
                </div>
                <strong>{percentLabel(stage.summary)}</strong>
              </div>
              {stage.summary.completionRatePercent === undefined ? null : (
                <progress
                  max={100}
                  value={stage.summary.completionRatePercent}
                  aria-label={`${stage.stageTitle}完成率`}
                />
              )}
              <div className="plan-progress-stage-metrics">
                <span>完成 {stage.summary.completedTaskCount}</span>
                <span>待完成 {stage.summary.remainingTaskCount}</span>
                <span
                  className={
                    stage.summary.overdueTaskCount > 0
                      ? "progress-overdue"
                      : undefined
                  }
                >
                  逾期 {stage.summary.overdueTaskCount}
                </span>
                <span>计划 {minutesLabel(stage.summary.plannedMinutes)}</span>
                <span>实际 {minutesLabel(stage.summary.actualMinutes)}</span>
              </div>
              <small>
                已生成 {stage.summary.generatedTaskCount} · 已取消{" "}
                {stage.summary.canceledTaskCount} · 回收站{" "}
                {stage.summary.trashedTaskCount}
              </small>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function percentLabel(summary: PlanProgressSummary): string {
  return summary.completionRatePercent === undefined
    ? "—"
    : `${summary.completionRatePercent}%`;
}

function minutesLabel(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} 小时` : `${hours} 小时 ${remainder} 分`;
}
