import { useEffect, useRef, useState } from "react";

import {
  getStudyStatistics,
  localDateForTimezone,
  normalizeScheduleCommandError,
  type ScheduleCommandError,
  type StudyStatistics,
} from "../../shared/tauri/scheduleClient";
import { getWorkspaceStatus } from "../../shared/tauri/workspaceClient";
import { addLocalDays, startOfLocalWeek } from "./scheduleDates";

type StatisticsState =
  | { kind: "loading" }
  | { kind: "missing-workspace" }
  | {
      kind: "ready";
      startDate: string;
      endDate: string;
      today: string;
      statistics: StudyStatistics;
    }
  | { kind: "error"; error: ScheduleCommandError };

async function loadInitialStatistics(): Promise<StatisticsState> {
  const workspace = await getWorkspaceStatus();
  if (workspace === null) {
    return { kind: "missing-workspace" };
  }
  const today = localDateForTimezone(new Date(), workspace.timezone);
  const startDate = startOfLocalWeek(today);
  const endDate = addLocalDays(startDate, 6);
  const statistics = await getStudyStatistics(startDate, endDate, today);
  return { kind: "ready", startDate, endDate, today, statistics };
}

export function StudyStatisticsPanel() {
  const [state, setState] = useState<StatisticsState>({ kind: "loading" });
  const requestSequence = useRef(0);

  useEffect(() => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    void loadInitialStatistics().then(
      (loaded) => {
        if (requestSequence.current === requestId) {
          setState(loaded);
        }
      },
      (error: unknown) => {
        if (requestSequence.current === requestId) {
          setState({
            kind: "error",
            error: normalizeScheduleCommandError(error),
          });
        }
      },
    );
    return () => {
      requestSequence.current += 1;
    };
  }, []);

  const reloadInitial = async () => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setState({ kind: "loading" });
    try {
      const loaded = await loadInitialStatistics();
      if (requestSequence.current === requestId) {
        setState(loaded);
      }
    } catch (error: unknown) {
      if (requestSequence.current === requestId) {
        setState({
          kind: "error",
          error: normalizeScheduleCommandError(error),
        });
      }
    }
  };

  const loadRange = async (startDate: string, endDate: string) => {
    if (state.kind !== "ready" || startDate === "" || endDate === "") {
      return;
    }
    if (endDate < startDate) {
      setState({
        kind: "error",
        error: {
          code: "SCHEDULE_INPUT_INVALID",
          message: "统计结束日期不能早于开始日期。",
          action: "重新选择日期范围。",
        },
      });
      return;
    }
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    const today = state.today;
    setState({ kind: "loading" });
    try {
      const statistics = await getStudyStatistics(startDate, endDate, today);
      if (requestSequence.current === requestId) {
        setState({ kind: "ready", startDate, endDate, today, statistics });
      }
    } catch (error: unknown) {
      if (requestSequence.current === requestId) {
        setState({
          kind: "error",
          error: normalizeScheduleCommandError(error),
        });
      }
    }
  };

  if (state.kind === "loading") {
    return <p className="schedule-status">正在计算学习统计…</p>;
  }
  if (state.kind === "missing-workspace") {
    return <p className="empty-state">先创建工作区，再查看统计。</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="error-detail" role="alert">
        <p>{state.error.message}</p>
        <p>{state.error.action}</p>
        <button type="button" onClick={() => void reloadInitial()}>
          回到本周
        </button>
      </div>
    );
  }

  const statistics = state.statistics;
  return (
    <div className="statistics-panel">
      <form
        className="statistics-range"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void loadRange(
            String(form.get("startDate") ?? ""),
            String(form.get("endDate") ?? ""),
          );
        }}
      >
        <label>
          开始日期
          <input
            name="startDate"
            type="date"
            defaultValue={state.startDate}
            required
          />
        </label>
        <label>
          结束日期
          <input
            name="endDate"
            type="date"
            defaultValue={state.endDate}
            required
          />
        </label>
        <button type="submit">重新统计</button>
      </form>
      <dl className="statistics-grid">
        <div>
          <dt>正式任务</dt>
          <dd>
            {statistics.completedTaskCount} / {statistics.taskCount}
          </dd>
        </div>
        <div>
          <dt>完成率</dt>
          <dd>
            {statistics.completionRatePercent === undefined
              ? "—"
              : `${statistics.completionRatePercent}%`}
          </dd>
        </div>
        <div>
          <dt>计划分钟</dt>
          <dd>{statistics.plannedMinutes}</dd>
        </div>
        <div>
          <dt>实际分钟</dt>
          <dd>{statistics.actualMinutes}</dd>
        </div>
        <div>
          <dt>实际 - 计划</dt>
          <dd>
            {statistics.minuteDifference > 0 ? "+" : ""}
            {statistics.minuteDifference}
          </dd>
        </div>
        <div>
          <dt>当前逾期</dt>
          <dd>{statistics.overdueTaskCount} 项</dd>
        </div>
      </dl>
      <p className="planning-note">
        完成率不包含已取消和回收站任务；没有正式任务时显示“—”，不会伪造 100%。
      </p>
      <h3>按科目汇总</h3>
      {statistics.subjects.length === 0 ? (
        <p className="empty-state">当前范围还没有可统计的数据。</p>
      ) : (
        <ul className="subject-statistics-list">
          {statistics.subjects.map((subject) => (
            <li key={subject.subjectId ?? "unclassified"}>
              <span
                className={`subject-dot subject-color-${subject.colorKey}`}
                aria-hidden="true"
              />
              <strong>{subject.subjectName}</strong>
              <span>{subject.taskCount} 项任务</span>
              <span>{subject.actualMinutes} 分钟实际学习</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
