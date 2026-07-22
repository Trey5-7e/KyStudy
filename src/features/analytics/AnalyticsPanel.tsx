import { useEffect, useState } from "react";

import {
  getAnalyticsOverview,
  normalizeAnalyticsError,
  type AnalyticsDays,
  type AnalyticsOverview,
} from "../../shared/tauri/analyticsClient";
import {
  localDateForTimezone,
  type ScheduleCommandError,
} from "../../shared/tauri/scheduleClient";
import { getWorkspaceStatus } from "../../shared/tauri/workspaceClient";

type AnalyticsState =
  | { kind: "loading"; days: AnalyticsDays }
  | { kind: "missing-workspace"; days: AnalyticsDays }
  | { kind: "ready"; days: AnalyticsDays; overview: AnalyticsOverview }
  | { kind: "error"; days: AnalyticsDays; error: ScheduleCommandError };

interface AnalyticsPanelProps {
  onOpenSchedule(): void;
  onOpenReview(): void;
  onOpenMindMap(): void;
  onOpenAi(): void;
}

async function loadAnalytics(days: AnalyticsDays): Promise<AnalyticsState> {
  const workspace = await getWorkspaceStatus();
  if (workspace === null) {
    return { kind: "missing-workspace", days };
  }
  const today = localDateForTimezone(new Date(), workspace.timezone);
  return {
    kind: "ready",
    days,
    overview: await getAnalyticsOverview(today, days),
  };
}

export function AnalyticsPanel({
  onOpenSchedule,
  onOpenReview,
  onOpenMindMap,
  onOpenAi,
}: AnalyticsPanelProps) {
  const [state, setState] = useState<AnalyticsState>({
    kind: "loading",
    days: 28,
  });

  const reload = async (days: AnalyticsDays) => {
    setState({ kind: "loading", days });
    try {
      setState(await loadAnalytics(days));
    } catch (error: unknown) {
      setState({ kind: "error", days, error: normalizeAnalyticsError(error) });
    }
  };

  useEffect(() => {
    let active = true;
    void loadAnalytics(28).then(
      (loaded) => {
        if (active) {
          setState(loaded);
        }
      },
      (error: unknown) => {
        if (active) {
          setState({
            kind: "error",
            days: 28,
            error: normalizeAnalyticsError(error),
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="analytics-card" aria-labelledby="analytics-title">
      <div className="analytics-heading">
        <div>
          <p className="section-label">M11 · 学习分析</p>
          <h2 id="analytics-title">用真实执行和作答调整下一步</h2>
        </div>
        <div className="analytics-period" aria-label="分析周期">
          {([7, 28, 90] as const).map((days) => (
            <button
              key={days}
              type="button"
              className={
                state.days === days
                  ? "analytics-period-active"
                  : "secondary-button"
              }
              disabled={state.kind === "loading"}
              onClick={() => void reload(days)}
            >
              {days} 天
            </button>
          ))}
        </div>
      </div>

      {state.kind === "loading" ? (
        <p className="empty-state">正在聚合本地学习数据…</p>
      ) : state.kind === "missing-workspace" ? (
        <p className="empty-state">先创建工作区并记录学习数据。</p>
      ) : state.kind === "error" ? (
        <div className="error-detail" role="alert">
          <strong>{state.error.message}</strong>
          <p>{state.error.action}</p>
          <button type="button" onClick={() => void reload(state.days)}>
            重新统计
          </button>
        </div>
      ) : (
        <AnalyticsContent
          overview={state.overview}
          onOpenSchedule={onOpenSchedule}
          onOpenReview={onOpenReview}
          onOpenMindMap={onOpenMindMap}
          onOpenAi={onOpenAi}
        />
      )}
    </section>
  );
}

function AnalyticsContent({
  overview,
  onOpenSchedule,
  onOpenReview,
  onOpenMindMap,
  onOpenAi,
}: Omit<AnalyticsPanelProps, never> & { overview: AnalyticsOverview }) {
  const current = overview.current;
  const previous = overview.previous;
  return (
    <div className="analytics-content">
      <p className="analytics-range-note">
        当前：{overview.rangeStart} 至 {overview.rangeEnd} · 对比：
        {overview.previousRangeStart} 至 {overview.previousRangeEnd}
      </p>

      <div className="analytics-summary-grid">
        <MetricCard
          label="任务完成率"
          value={formatPercent(current.completionRatePercent)}
          detail={`${current.completedTaskCount} / ${current.taskCount} 项`}
          delta={percentDelta(
            current.completionRatePercent,
            previous.completionRatePercent,
          )}
        />
        <MetricCard
          label="实际学习"
          value={formatDuration(current.actualMinutes)}
          detail={`计划 ${formatDuration(current.plannedMinutes)}`}
          delta={numberDelta(
            current.actualMinutes,
            previous.actualMinutes,
            "分钟",
          )}
        />
        <MetricCard
          label="题目正确率"
          value={formatPercent(current.accuracyPercent)}
          detail={`${current.correctAttemptCount} / ${current.attemptCount} 次作答`}
          delta={percentDelta(
            current.accuracyPercent,
            previous.accuracyPercent,
          )}
        />
        <MetricCard
          label="复习完成率"
          value={formatPercent(current.reviewCompletionPercent)}
          detail={`${current.completedReviewCount} / ${current.reviewItemCount} 道`}
          delta={percentDelta(
            current.reviewCompletionPercent,
            previous.reviewCompletionPercent,
          )}
        />
      </div>

      <div className="analytics-backlog-grid">
        <ActionMetric
          label="逾期任务"
          value={overview.backlog.overdueTasks}
          action="查看日程"
          onClick={onOpenSchedule}
        />
        <ActionMetric
          label="活跃错题"
          value={overview.backlog.activeMistakes}
          action="进入错题复习"
          onClick={onOpenReview}
        />
        <ActionMetric
          label="到期复习"
          value={overview.backlog.dueReviews}
          action="处理复习"
          onClick={onOpenReview}
        />
        <ActionMetric
          label="今日队列剩余"
          value={overview.backlog.queuedReviews}
          action="继续复习"
          onClick={onOpenReview}
        />
      </div>

      <DailyActivityChart overview={overview} />

      <div className="analytics-two-column">
        <section aria-labelledby="subject-insights-title">
          <h3 id="subject-insights-title">科目投入与任务完成</h3>
          {overview.subjects.length === 0 ? (
            <p className="empty-state">当前周期还没有科目任务或学习记录。</p>
          ) : (
            <ul className="analytics-subject-list">
              {overview.subjects.map((subject) => (
                <li key={subject.subjectId ?? "unclassified"}>
                  <div>
                    <span
                      className={`subject-dot subject-color-${subject.colorKey}`}
                      aria-hidden="true"
                    />
                    <strong>{subject.subjectName}</strong>
                    <span>{formatDuration(subject.actualMinutes)}</span>
                  </div>
                  <progress
                    aria-label={`${subject.subjectName}任务完成率`}
                    max={100}
                    value={subject.completionRatePercent ?? 0}
                  />
                  <small>
                    {subject.completedTaskCount} / {subject.taskCount} 项 ·
                    完成率 {formatPercent(subject.completionRatePercent)}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="knowledge-insights-title">
          <div className="analytics-section-heading">
            <h3 id="knowledge-insights-title">需要关注的知识节点</h3>
            <button
              type="button"
              className="secondary-button"
              onClick={onOpenMindMap}
            >
              打开思维导图
            </button>
          </div>
          {overview.knowledge.length === 0 ? (
            <p className="empty-state">
              关联题目并记录作答后，这里会显示薄弱节点。
            </p>
          ) : (
            <ol className="analytics-knowledge-list">
              {overview.knowledge.map((node) => (
                <li key={node.nodeId}>
                  <div>
                    <strong>{node.nodeTitle}</strong>
                    <span>
                      {node.subjectName ?? "未分类"} · {node.mapTitle}
                    </span>
                  </div>
                  <span>{formatPercent(node.accuracyPercent)} 正确率</span>
                  <span>{node.activeMistakeCount} 道活跃错题</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section
        className="analytics-mistakes"
        aria-labelledby="repeated-mistakes-title"
      >
        <div className="analytics-section-heading">
          <h3 id="repeated-mistakes-title">反复出错题目</h3>
          <button
            type="button"
            className="secondary-button"
            onClick={onOpenReview}
          >
            打开错题复习
          </button>
        </div>
        {overview.repeatedMistakes.length === 0 ? (
          <p className="empty-state">目前没有重复错误或连续失败的活跃错题。</p>
        ) : (
          <ol>
            {overview.repeatedMistakes.map((mistake) => (
              <li key={mistake.questionId}>
                <div>
                  <strong>{mistake.questionTitle}</strong>
                  <span>{mistake.documentTitle}</span>
                </div>
                <span>累计错误 {mistake.mistakeCount} 次</span>
                <span>连续未掌握 {mistake.consecutiveFailureCount} 次</span>
                <span>下次 {mistake.dueDate}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section
        className="analytics-ai-usage"
        aria-labelledby="analytics-ai-title"
      >
        <div>
          <h3 id="analytics-ai-title">AI Token</h3>
          <p>
            当前周期实际新增 {current.aiTokens.toLocaleString("zh-CN")} Token
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={onOpenAi}>
          查看预算与调用记录
        </button>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  delta,
}: {
  label: string;
  value: string;
  detail: string;
  delta: string;
}) {
  return (
    <article className="analytics-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <small>{delta}</small>
    </article>
  );
}

function ActionMetric({
  label,
  value,
  action,
  onClick,
}: {
  label: string;
  value: number;
  action: string;
  onClick(): void;
}) {
  return (
    <article className="analytics-action-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <button type="button" className="secondary-button" onClick={onClick}>
        {action}
      </button>
    </article>
  );
}

function DailyActivityChart({ overview }: { overview: AnalyticsOverview }) {
  let maximumMinutes = 1;
  for (const point of overview.daily) {
    maximumMinutes = Math.max(
      maximumMinutes,
      point.plannedMinutes,
      point.actualMinutes,
    );
  }
  return (
    <section className="analytics-daily" aria-labelledby="daily-activity-title">
      <div className="analytics-section-heading">
        <h3 id="daily-activity-title">每日计划与实际投入</h3>
        <div className="analytics-chart-legend" aria-label="图例">
          <span>
            <i className="analytics-legend-planned" aria-hidden="true" />
            计划分钟
          </span>
          <span>
            <i className="analytics-legend-actual" aria-hidden="true" />
            实际分钟
          </span>
        </div>
      </div>
      <div className="analytics-chart-scroll">
        <div
          className="analytics-bar-chart"
          style={{ minWidth: `${Math.max(overview.daily.length * 34, 420)}px` }}
        >
          {overview.daily.map((point) => (
            <div className="analytics-day-column" key={point.date}>
              <div className="analytics-bars">
                <span
                  className="analytics-bar-planned"
                  style={{
                    height: `${(point.plannedMinutes / maximumMinutes) * 100}%`,
                  }}
                  title={`计划 ${point.plannedMinutes} 分钟`}
                />
                <span
                  className="analytics-bar-actual"
                  style={{
                    height: `${(point.actualMinutes / maximumMinutes) * 100}%`,
                  }}
                  title={`实际 ${point.actualMinutes} 分钟`}
                />
              </div>
              <time dateTime={point.date}>{point.date.slice(5)}</time>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "—" : `${value}%`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} 小时` : `${hours} 小时 ${remainder} 分`;
}

function percentDelta(
  current: number | undefined,
  previous: number | undefined,
): string {
  if (current === undefined || previous === undefined) {
    return "上一周期无可比数据";
  }
  const delta = current - previous;
  return `较上一周期 ${delta > 0 ? "+" : ""}${delta} 个百分点`;
}

function numberDelta(current: number, previous: number, unit: string): string {
  const delta = current - previous;
  return `较上一周期 ${delta > 0 ? "+" : ""}${delta} ${unit}`;
}
