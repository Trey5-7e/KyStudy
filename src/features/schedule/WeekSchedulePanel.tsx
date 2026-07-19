import { useEffect, useRef, useState } from "react";

import {
  listOverdueTasks,
  listSubjects,
  listTasksForRange,
  localDateForTimezone,
  normalizeScheduleCommandError,
  type ScheduleCommandError,
  type StudySubject,
  type StudyTask,
} from "../../shared/tauri/scheduleClient";
import { getWorkspaceStatus } from "../../shared/tauri/workspaceClient";
import {
  addLocalDays,
  formatLocalDateLabel,
  localWeekDates,
  startOfLocalWeek,
} from "./scheduleDates";

type WeekState =
  | { kind: "loading" }
  | { kind: "missing-workspace" }
  | {
      kind: "ready";
      today: string;
      weekStart: string;
      tasks: StudyTask[];
      overdue: StudyTask[];
      subjects: StudySubject[];
    }
  | { kind: "error"; error: ScheduleCommandError };

async function loadWeekInitial(): Promise<WeekState> {
  const workspace = await getWorkspaceStatus();
  if (workspace === null) {
    return { kind: "missing-workspace" };
  }
  const today = localDateForTimezone(new Date(), workspace.timezone);
  const weekStart = startOfLocalWeek(today);
  const weekEnd = addLocalDays(weekStart, 6);
  const [tasks, overdue, subjects] = await Promise.all([
    listTasksForRange(weekStart, weekEnd),
    listOverdueTasks(today),
    listSubjects(),
  ]);
  return { kind: "ready", today, weekStart, tasks, overdue, subjects };
}

export function WeekSchedulePanel() {
  const [state, setState] = useState<WeekState>({ kind: "loading" });
  const [subjectFilter, setSubjectFilter] = useState("");
  const requestSequence = useRef(0);

  const initialize = async () => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setState({ kind: "loading" });
    try {
      const loaded = await loadWeekInitial();
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

  useEffect(() => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    void loadWeekInitial().then(
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

  const loadWeek = async (weekStart: string) => {
    if (state.kind !== "ready") {
      return;
    }
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    const snapshot = state;
    setState({ kind: "loading" });
    try {
      const tasks = await listTasksForRange(
        weekStart,
        addLocalDays(weekStart, 6),
      );
      if (requestSequence.current === requestId) {
        setState({ ...snapshot, weekStart, tasks });
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
    return <p className="schedule-status">正在读取一周计划…</p>;
  }
  if (state.kind === "missing-workspace") {
    return <p className="empty-state">先创建本地工作区，再查看周日程。</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="error-detail" role="alert">
        <p>{state.error.message}</p>
        <p>{state.error.action}</p>
        <button type="button" onClick={() => void initialize()}>
          重新加载
        </button>
      </div>
    );
  }

  const weekDates = localWeekDates(state.weekStart);
  const subjects = new Map(
    state.subjects.map((subject) => [subject.id, subject]),
  );
  const matchesFilter = (task: StudyTask) =>
    subjectFilter === "" || task.subjectId === subjectFilter;
  const visibleTasks = state.tasks.filter(matchesFilter);
  const visibleOverdue = state.overdue.filter(matchesFilter);

  return (
    <div className="week-panel">
      <div className="week-toolbar">
        <div className="week-navigation">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadWeek(addLocalDays(state.weekStart, -7))}
          >
            上一周
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadWeek(startOfLocalWeek(state.today))}
          >
            回到今天
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadWeek(addLocalDays(state.weekStart, 7))}
          >
            下一周
          </button>
        </div>
        <label>
          按科目筛选
          <select
            value={subjectFilter}
            onChange={(event) => setSubjectFilter(event.target.value)}
          >
            <option value="">全部科目</option>
            {state.subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="week-grid">
        {weekDates.map((date) => {
          const tasks = visibleTasks.filter(
            (task) => task.plannedDate === date,
          );
          const plannedMinutes = tasks.reduce(
            (total, task) =>
              task.status === "canceled"
                ? total
                : total + (task.estimatedMinutes ?? 0),
            0,
          );
          const completed = tasks.filter(
            (task) => task.status === "done",
          ).length;
          return (
            <article
              key={date}
              className={
                date === state.today ? "week-day week-day-today" : "week-day"
              }
            >
              <header>
                <strong>{formatLocalDateLabel(date)}</strong>
                <span>
                  {plannedMinutes} 分钟 · 完成 {completed}
                </span>
              </header>
              {tasks.length === 0 ? (
                <p>暂无任务</p>
              ) : (
                <ul>
                  {tasks.map((task) => (
                    <li
                      key={task.id}
                      className={`week-task week-task-${task.status}`}
                    >
                      <strong>{task.title}</strong>
                      <span>
                        {task.subjectId === undefined
                          ? "未分类"
                          : (subjects.get(task.subjectId)?.name ?? "历史科目")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>

      <details className="overdue-panel" open={visibleOverdue.length > 0}>
        <summary>逾期未完成任务 · {visibleOverdue.length} 项</summary>
        {visibleOverdue.length === 0 ? (
          <p>当前筛选下没有逾期任务。</p>
        ) : (
          <ul>
            {visibleOverdue.map((task) => (
              <li key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <span>原计划 {task.plannedDate}</span>
                </div>
                <span>
                  {task.estimatedMinutes === undefined
                    ? "未估时"
                    : `${task.estimatedMinutes} 分钟`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
      <p className="planning-note">
        周视图只负责查看；调整日期仍从任务详情进入“延期”，以保留原因和历史。
      </p>
    </div>
  );
}
