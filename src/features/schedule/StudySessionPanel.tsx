import { useEffect, useRef, useState } from "react";

import {
  createStudySession,
  listOverdueTasks,
  listStudySessions,
  listSubjects,
  listTasksForRange,
  localDateForTimezone,
  normalizeScheduleCommandError,
  type ScheduleCommandError,
  type StudySession,
  type StudySubject,
  type StudyTask,
} from "../../shared/tauri/scheduleClient";
import { getWorkspaceStatus } from "../../shared/tauri/workspaceClient";

type SessionState =
  | { kind: "loading" }
  | { kind: "missing-workspace" }
  | {
      kind: "ready";
      date: string;
      tasks: StudyTask[];
      subjects: StudySubject[];
      sessions: StudySession[];
    }
  | { kind: "error"; error: ScheduleCommandError };

function uniqueTasks(tasks: StudyTask[]): StudyTask[] {
  return Array.from(new Map(tasks.map((task) => [task.id, task])).values());
}

async function loadInitialSessions(): Promise<SessionState> {
  const workspace = await getWorkspaceStatus();
  if (workspace === null) {
    return { kind: "missing-workspace" };
  }
  const date = localDateForTimezone(new Date(), workspace.timezone);
  const [subjects, plannedTasks, overdueTasks, sessions] = await Promise.all([
    listSubjects(),
    listTasksForRange(date, date),
    listOverdueTasks(date),
    listStudySessions(date, date),
  ]);
  return {
    kind: "ready",
    date,
    subjects,
    tasks: uniqueTasks([...plannedTasks, ...overdueTasks]),
    sessions,
  };
}

export function StudySessionPanel() {
  const [state, setState] = useState<SessionState>({ kind: "loading" });
  const [taskId, setTaskId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [completionPercent, setCompletionPercent] = useState("100");
  const [reflection, setReflection] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<ScheduleCommandError>();
  const [notice, setNotice] = useState<string>();
  const requestSequence = useRef(0);

  useEffect(() => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    void loadInitialSessions().then(
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

  const reload = async () => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setState({ kind: "loading" });
    try {
      const loaded = await loadInitialSessions();
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

  const loadDate = async (date: string) => {
    if (state.kind !== "ready" || date === "") {
      return;
    }
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    const subjects = state.subjects;
    setState({ kind: "loading" });
    try {
      const [plannedTasks, overdueTasks, sessions] = await Promise.all([
        listTasksForRange(date, date),
        listOverdueTasks(date),
        listStudySessions(date, date),
      ]);
      if (requestSequence.current === requestId) {
        setTaskId("");
        setSubjectId("");
        setState({
          kind: "ready",
          date,
          subjects,
          tasks: uniqueTasks([...plannedTasks, ...overdueTasks]),
          sessions,
        });
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
    return <p className="schedule-status">正在读取实际学习记录…</p>;
  }
  if (state.kind === "missing-workspace") {
    return <p className="empty-state">先创建本地工作区，再记录实际学习。</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="error-detail" role="alert">
        <p>{state.error.message}</p>
        <p>{state.error.action}</p>
        <button type="button" onClick={() => void reload()}>
          重新加载
        </button>
      </div>
    );
  }

  const taskById = new Map(state.tasks.map((task) => [task.id, task]));
  const subjectById = new Map(
    state.subjects.map((subject) => [subject.id, subject]),
  );
  const selectedTask = taskId === "" ? undefined : taskById.get(taskId);

  const selectTask = (nextTaskId: string) => {
    const task = nextTaskId === "" ? undefined : taskById.get(nextTaskId);
    setTaskId(nextTaskId);
    setSubjectId(task?.subjectId ?? "");
    setActionError(undefined);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const duration = Number(durationMinutes);
    const completion = Number(completionPercent);
    if (
      !Number.isSafeInteger(duration) ||
      duration < 1 ||
      duration > 1440 ||
      !Number.isSafeInteger(completion) ||
      completion < 0 ||
      completion > 100
    ) {
      setActionError({
        code: "SCHEDULE_INPUT_INVALID",
        message: "实际时长或完成度不在有效范围内。",
        action: "时长填写 1～1440 分钟，完成度填写 0～100。",
      });
      return;
    }
    setIsSubmitting(true);
    setActionError(undefined);
    setNotice(undefined);
    try {
      const created = await createStudySession({
        ...(taskId === "" ? {} : { taskId }),
        ...(subjectId === "" ? {} : { subjectId }),
        sessionDate: state.date,
        durationMinutes: duration,
        completionPercent: completion,
        ...(reflection.trim() === "" ? {} : { reflection }),
      });
      setState((current) =>
        current.kind === "ready" && current.date === created.sessionDate
          ? { ...current, sessions: [created, ...current.sessions] }
          : current,
      );
      setDurationMinutes("60");
      setCompletionPercent("100");
      setReflection("");
      setNotice("实际学习记录已保存，任务的预计时长保持不变。");
    } catch (error: unknown) {
      setActionError(normalizeScheduleCommandError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="session-panel">
      <div className="session-heading">
        <div>
          <h3>手动记录一次学习</h3>
          <p>同一任务可以记录多次；首版不加入计时器，先保证记录真实可靠。</p>
        </div>
        <label>
          记录日期
          <input
            type="date"
            value={state.date}
            onChange={(event) => void loadDate(event.target.value)}
          />
        </label>
      </div>

      <form className="session-form" onSubmit={(event) => void submit(event)}>
        <label>
          关联任务
          <select
            value={taskId}
            disabled={isSubmitting}
            onChange={(event) => selectTask(event.target.value)}
          >
            <option value="">不关联具体任务</option>
            {state.tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.plannedDate} · {task.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          科目
          <select
            value={subjectId}
            disabled={isSubmitting || selectedTask !== undefined}
            onChange={(event) => setSubjectId(event.target.value)}
          >
            <option value="">未分类</option>
            {state.subjects
              .filter(
                (subject) =>
                  subject.archivedAt === undefined ||
                  subject.id === selectedTask?.subjectId,
              )
              .map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          实际分钟
          <input
            type="number"
            min={1}
            max={1440}
            required
            disabled={isSubmitting}
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
          />
        </label>
        <label>
          本次完成度（%）
          <input
            type="number"
            min={0}
            max={100}
            required
            disabled={isSubmitting}
            value={completionPercent}
            onChange={(event) => setCompletionPercent(event.target.value)}
          />
        </label>
        <label className="session-reflection">
          复盘
          <textarea
            rows={3}
            maxLength={2000}
            disabled={isSubmitting}
            value={reflection}
            placeholder="可选：今天卡在哪里、下一次先做什么"
            onChange={(event) => setReflection(event.target.value)}
          />
        </label>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "正在保存…" : "保存学习记录"}
        </button>
      </form>

      {actionError === undefined ? null : (
        <div className="error-detail" role="alert">
          <p>{actionError.message}</p>
          <p>{actionError.action}</p>
        </div>
      )}
      {notice === undefined ? null : (
        <p className="success-detail" role="status">
          {notice}
        </p>
      )}

      <div className="session-list-heading">
        <h3>{state.date} 的记录</h3>
        <strong>
          {state.sessions.reduce(
            (total, session) => total + session.durationMinutes,
            0,
          )}{" "}
          分钟
        </strong>
      </div>
      {state.sessions.length === 0 ? (
        <p className="empty-state">这一天还没有实际学习记录。</p>
      ) : (
        <ul className="session-list">
          {state.sessions.map((session) => (
            <li key={session.id}>
              <div>
                <strong>
                  {session.taskId === undefined
                    ? "自主学习"
                    : (taskById.get(session.taskId)?.title ?? "历史任务")}
                </strong>
                <span>
                  {session.subjectId === undefined
                    ? "未分类"
                    : (subjectById.get(session.subjectId)?.name ?? "历史科目")}
                </span>
              </div>
              <div className="session-measure">
                <strong>{session.durationMinutes} 分钟</strong>
                <span>完成度 {session.completionPercent}%</span>
              </div>
              {session.reflection === undefined ? null : (
                <p>{session.reflection}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
