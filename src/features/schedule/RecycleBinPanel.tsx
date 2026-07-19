import { useEffect, useState } from "react";

import {
  listTrashedTasks,
  normalizeScheduleCommandError,
  restoreTrashedTask,
  type ScheduleCommandError,
  type TrashedStudyTask,
} from "../../shared/tauri/scheduleClient";

type TrashState =
  | { kind: "loading" }
  | { kind: "ready"; tasks: TrashedStudyTask[] }
  | { kind: "error"; error: ScheduleCommandError };

export function RecycleBinPanel() {
  const [state, setState] = useState<TrashState>({ kind: "loading" });
  const [restoringId, setRestoringId] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = async () => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "ready", tasks: await listTrashedTasks() });
    } catch (error: unknown) {
      setState({ kind: "error", error: normalizeScheduleCommandError(error) });
    }
  };

  useEffect(() => {
    let active = true;
    void listTrashedTasks().then(
      (tasks) => {
        if (active) {
          setState({ kind: "ready", tasks });
        }
      },
      (error: unknown) => {
        if (active) {
          setState({
            kind: "error",
            error: normalizeScheduleCommandError(error),
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const restore = async (task: TrashedStudyTask) => {
    setRestoringId(task.id);
    setNotice(undefined);
    try {
      const restored = await restoreTrashedTask(task.id);
      setState((current) =>
        current.kind === "ready"
          ? {
              kind: "ready",
              tasks: current.tasks.filter((item) => item.id !== restored.id),
            }
          : current,
      );
      setNotice(
        restored.status === "canceled"
          ? "任务已回到原计划中，仍保持“已取消”状态；如需继续，请在任务详情中恢复状态。"
          : "任务已回到原计划日期，原生命周期状态保持不变。",
      );
    } catch (error: unknown) {
      setState({ kind: "error", error: normalizeScheduleCommandError(error) });
    } finally {
      setRestoringId(undefined);
    }
  };

  if (state.kind === "loading") {
    return <p className="schedule-status">正在读取回收站…</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="error-detail" role="alert">
        <p>{state.error.message}</p>
        <p>{state.error.action}</p>
        <button type="button" onClick={() => void load()}>
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div className="trash-panel">
      <div className="trash-heading">
        <div>
          <h3>任务回收站</h3>
          <p>这里是软删除，不会清除任务历史或学习记录关联。</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void load()}
        >
          刷新
        </button>
      </div>
      {notice === undefined ? null : (
        <p className="success-detail" role="status">
          {notice}
        </p>
      )}
      {state.tasks.length === 0 ? (
        <p className="empty-state">回收站是空的。</p>
      ) : (
        <ul className="trash-list">
          {state.tasks.map((task) => (
            <li key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <span>
                  原计划 {task.plannedDate} · 删除于{" "}
                  {new Date(task.deletedAt).toLocaleString("zh-CN")}
                </span>
              </div>
              <button
                type="button"
                disabled={restoringId !== undefined}
                onClick={() => void restore(task)}
              >
                {restoringId === task.id ? "正在恢复…" : "恢复到计划"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
