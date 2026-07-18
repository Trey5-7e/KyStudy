import { useEffect, useRef, useState } from "react";

import {
  createTask,
  listTasksForRange,
  localDateForTimezone,
  normalizeScheduleCommandError,
  transitionTask,
  type ScheduleCommandError,
  type StudyTask,
  type TaskPriority,
  type TaskTransition,
} from "../../shared/tauri/scheduleClient";
import { getWorkspaceStatus } from "../../shared/tauri/workspaceClient";

type TaskListState =
  | { kind: "loading" }
  | { kind: "missing-workspace" }
  | { kind: "ready"; tasks: StudyTask[] }
  | { kind: "error"; error: ScheduleCommandError };

type InitialSchedule =
  | { kind: "missing-workspace" }
  | { kind: "ready"; date: string; tasks: StudyTask[] };

const STATUS_ORDER = {
  in_progress: 0,
  todo: 1,
  done: 2,
  canceled: 3,
} as const;

const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 } as const;

function sortTasks(tasks: StudyTask[]): StudyTask[] {
  return tasks.slice().sort((left, right) => {
    return (
      STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
      PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] ||
      left.manualOrder - right.manualOrder ||
      left.createdAt - right.createdAt ||
      left.id.localeCompare(right.id)
    );
  });
}

function upsertTask(tasks: StudyTask[], changed: StudyTask): StudyTask[] {
  return sortTasks([
    ...tasks.filter((task) => task.id !== changed.id),
    changed,
  ]);
}

function priorityLabel(priority: TaskPriority): string {
  switch (priority) {
    case "high":
      return "高优先";
    case "low":
      return "低优先";
    default:
      return "普通";
  }
}

async function loadInitialSchedule(): Promise<InitialSchedule> {
  const workspace = await getWorkspaceStatus();
  if (workspace === null) {
    return { kind: "missing-workspace" };
  }
  const date = localDateForTimezone(new Date(), workspace.timezone);
  const tasks = await listTasksForRange(date, date);
  return { kind: "ready", date, tasks };
}

export function TodayTaskPanel() {
  const [selectedDate, setSelectedDate] = useState("");
  const [state, setState] = useState<TaskListState>({ kind: "loading" });
  const [title, setTitle] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<ScheduleCommandError>();
  const requestSequence = useRef(0);
  const selectedDateRef = useRef("");

  const loadDate = async (date: string) => {
    if (date === "") {
      return;
    }
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setState({ kind: "loading" });
    try {
      const tasks = await listTasksForRange(date, date);
      if (requestSequence.current === requestId) {
        setState({ kind: "ready", tasks });
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

  const initialize = async () => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setState({ kind: "loading" });
    try {
      const result = await loadInitialSchedule();
      if (requestSequence.current !== requestId) {
        return;
      }
      if (result.kind === "missing-workspace") {
        setState({ kind: "missing-workspace" });
        return;
      }
      selectedDateRef.current = result.date;
      setSelectedDate(result.date);
      setState({ kind: "ready", tasks: result.tasks });
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
    void loadInitialSchedule().then(
      (result) => {
        if (requestSequence.current !== requestId) {
          return;
        }
        if (result.kind === "missing-workspace") {
          setState({ kind: "missing-workspace" });
          return;
        }
        selectedDateRef.current = result.date;
        setSelectedDate(result.date);
        setState({ kind: "ready", tasks: result.tasks });
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

  const handleDateChange = (date: string) => {
    if (date === "") {
      return;
    }
    selectedDateRef.current = date;
    setSelectedDate(date);
    setActionError(undefined);
    void loadDate(date);
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedDate === "" || title.trim() === "") {
      return;
    }
    const parsedMinutes =
      estimatedMinutes === "" ? undefined : Number(estimatedMinutes);
    if (
      parsedMinutes !== undefined &&
      (!Number.isSafeInteger(parsedMinutes) ||
        parsedMinutes < 1 ||
        parsedMinutes > 1440)
    ) {
      setActionError({
        code: "SCHEDULE_INPUT_INVALID",
        message: "预计时长需要在 1 到 1440 分钟之间。",
        action: "修改预计时长后重试。",
      });
      return;
    }
    setIsSubmitting(true);
    setActionError(undefined);
    try {
      const task = await createTask({
        title,
        plannedDate: selectedDate,
        ...(parsedMinutes === undefined
          ? {}
          : { estimatedMinutes: parsedMinutes }),
        priority,
        manualOrder: state.kind === "ready" ? state.tasks.length : 0,
      });
      setState((current) =>
        current.kind === "ready" && task.plannedDate === selectedDateRef.current
          ? { kind: "ready", tasks: upsertTask(current.tasks, task) }
          : current,
      );
      setTitle("");
      setEstimatedMinutes("");
      setPriority("normal");
    } catch (error: unknown) {
      setActionError(normalizeScheduleCommandError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTransition = async (
    taskId: string,
    transition: TaskTransition,
  ) => {
    setActionError(undefined);
    try {
      const changed = await transitionTask(taskId, transition);
      setState((current) =>
        current.kind === "ready" &&
        changed.plannedDate === selectedDateRef.current
          ? { kind: "ready", tasks: upsertTask(current.tasks, changed) }
          : current,
      );
    } catch (error: unknown) {
      setActionError(normalizeScheduleCommandError(error));
    }
  };

  const completedCount =
    state.kind === "ready"
      ? state.tasks.filter((task) => task.status === "done").length
      : 0;
  const plannedMinutes =
    state.kind === "ready"
      ? state.tasks.reduce(
          (total, task) => total + (task.estimatedMinutes ?? 0),
          0,
        )
      : 0;

  return (
    <section className="today-card" aria-labelledby="today-title">
      <div className="today-heading">
        <div>
          <p className="section-label">M2 · 今日清单</p>
          <h2 id="today-title">今天真正要完成什么</h2>
        </div>
        {selectedDate === "" ? null : (
          <label className="date-control">
            查看日期
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => handleDateChange(event.target.value)}
            />
          </label>
        )}
      </div>

      {state.kind === "missing-workspace" ? (
        <div className="empty-state">
          <p>先创建本地工作区，再开始记录每日任务。</p>
          <button type="button" onClick={() => void initialize()}>
            重新检查工作区
          </button>
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div className="error-detail" role="alert">
          <p>{state.error.message}</p>
          <p>{state.error.action}</p>
          <button type="button" onClick={() => void initialize()}>
            重新加载
          </button>
        </div>
      ) : null}

      {state.kind === "loading" ? (
        <p className="schedule-status" aria-live="polite">
          正在读取本地任务…
        </p>
      ) : null}

      {state.kind === "ready" ? (
        <>
          <dl className="today-summary">
            <div>
              <dt>完成</dt>
              <dd>
                {completedCount} / {state.tasks.length}
              </dd>
            </div>
            <div>
              <dt>计划时长</dt>
              <dd>{plannedMinutes} 分钟</dd>
            </div>
          </dl>

          <form
            className="quick-task-form"
            onSubmit={(event) => void handleCreate(event)}
          >
            <label className="task-title-field">
              任务标题
              <input
                type="text"
                maxLength={120}
                required
                value={title}
                placeholder="例如：完成线性代数强化第 3 讲"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              预计分钟
              <input
                type="number"
                min={1}
                max={1440}
                value={estimatedMinutes}
                placeholder="可选"
                onChange={(event) => setEstimatedMinutes(event.target.value)}
              />
            </label>
            <label>
              优先级
              <select
                value={priority}
                onChange={(event) =>
                  setPriority(event.target.value as TaskPriority)
                }
              >
                <option value="normal">普通</option>
                <option value="high">高优先</option>
                <option value="low">低优先</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={isSubmitting || title.trim() === ""}
            >
              {isSubmitting ? "正在添加…" : "添加任务"}
            </button>
          </form>

          {actionError === undefined ? null : (
            <div className="error-detail" role="alert">
              <p>{actionError.message}</p>
              <p>{actionError.action}</p>
            </div>
          )}

          {state.tasks.length === 0 ? (
            <p className="empty-state">
              这一天还没有任务，可以先添加一件最重要的事。
            </p>
          ) : (
            <ul className="task-list">
              {state.tasks.map((task) => (
                <li key={task.id} className={`task-item task-${task.status}`}>
                  <button
                    type="button"
                    className="task-check"
                    aria-label={
                      task.status === "done" ? "重新打开任务" : "完成任务"
                    }
                    onClick={() =>
                      void handleTransition(
                        task.id,
                        task.status === "done" ? "reopen" : "complete",
                      )
                    }
                  >
                    {task.status === "done" ? "✓" : "○"}
                  </button>
                  <div className="task-copy">
                    <strong>{task.title}</strong>
                    <span>
                      {priorityLabel(task.priority)}
                      {task.estimatedMinutes === undefined
                        ? " · 未设置预计时长"
                        : ` · ${task.estimatedMinutes} 分钟`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
