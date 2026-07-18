import { useEffect, useMemo, useState } from "react";

import {
  listTaskChanges,
  normalizeScheduleCommandError,
  type ScheduleCommandError,
  type StudySubject,
  type StudyTaskChange,
  type TaskChangeSnapshot,
  type TaskChangeType,
  type TaskPriority,
  type TaskStatus,
} from "../../shared/tauri/scheduleClient";

type HistoryState =
  | { kind: "loading" }
  | { kind: "ready"; changes: StudyTaskChange[] }
  | { kind: "error"; error: ScheduleCommandError };

const CHANGE_LABELS: Record<TaskChangeType, string> = {
  created: "创建任务",
  edited: "编辑任务详情",
  rescheduled: "调整计划日期",
  started: "开始学习",
  completed: "完成任务",
  reopened: "重新打开任务",
  canceled: "取消任务",
  restored: "恢复任务",
  split: "拆分任务",
  trashed: "移入回收站",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "低优先",
  normal: "普通",
  high: "高优先",
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "待开始",
  in_progress: "学习中",
  done: "已完成",
  canceled: "已取消",
};

interface TaskHistoryPanelProps {
  taskId: string;
  subjects: StudySubject[];
  timezone: string;
}

function subjectLabel(
  subjectId: string | undefined,
  subjectById: ReadonlyMap<string, StudySubject>,
): string {
  if (subjectId === undefined) {
    return "未分类";
  }
  return subjectById.get(subjectId)?.name ?? "原科目";
}

function minutesLabel(minutes: number | undefined): string {
  return minutes === undefined ? "未设置" : `${minutes} 分钟`;
}

function describeEditedFields(
  before: TaskChangeSnapshot,
  after: TaskChangeSnapshot,
  subjectById: ReadonlyMap<string, StudySubject>,
): string[] {
  const details: string[] = [];
  if (before.title !== after.title) {
    details.push(`标题：“${before.title}” → “${after.title}”`);
  }
  if (before.description !== after.description) {
    details.push(
      after.description === undefined
        ? "清空说明"
        : before.description === undefined
          ? "新增说明"
          : "更新说明",
    );
  }
  if (before.subjectId !== after.subjectId) {
    details.push(
      `科目：${subjectLabel(before.subjectId, subjectById)} → ${subjectLabel(after.subjectId, subjectById)}`,
    );
  }
  if (before.estimatedMinutes !== after.estimatedMinutes) {
    details.push(
      `预计时长：${minutesLabel(before.estimatedMinutes)} → ${minutesLabel(after.estimatedMinutes)}`,
    );
  }
  if (before.priority !== after.priority) {
    details.push(
      `优先级：${PRIORITY_LABELS[before.priority]} → ${PRIORITY_LABELS[after.priority]}`,
    );
  }
  return details;
}

function changeDetails(
  change: StudyTaskChange,
  subjectById: ReadonlyMap<string, StudySubject>,
): string[] {
  const before = change.before;
  const after = change.after;
  switch (change.changeType) {
    case "created":
      return after === undefined ? [] : [`计划日期：${after.plannedDate}`];
    case "edited":
      return before === undefined || after === undefined
        ? []
        : describeEditedFields(before, after, subjectById);
    case "rescheduled":
      return [
        ...(before === undefined || after === undefined
          ? []
          : [`日期：${before.plannedDate} → ${after.plannedDate}`]),
        ...(change.reason === undefined ? [] : [`原因：${change.reason}`]),
      ];
    case "started":
    case "completed":
    case "reopened":
    case "canceled":
    case "restored":
      return after === undefined
        ? []
        : [`状态：${STATUS_LABELS[after.status]}`];
    case "split":
      return ["任务已拆分，子任务将在后续版本中显示"];
    case "trashed":
      return ["任务已移入回收站"];
  }
}

export function TaskHistoryPanel({
  taskId,
  subjects,
  timezone,
}: TaskHistoryPanelProps) {
  const [state, setState] = useState<HistoryState>({ kind: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    [timezone],
  );
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));

  useEffect(() => {
    let isActive = true;
    void listTaskChanges(taskId).then(
      (changes) => {
        if (isActive) {
          setState({ kind: "ready", changes });
        }
      },
      (reason: unknown) => {
        if (isActive) {
          setState({
            kind: "error",
            error: normalizeScheduleCommandError(reason),
          });
        }
      },
    );
    return () => {
      isActive = false;
    };
  }, [taskId, reloadToken]);

  return (
    <section className="task-history" aria-labelledby="task-history-title">
      <div className="task-history-heading">
        <div>
          <p className="section-label">变化历史</p>
          <h4 id="task-history-title">这项任务如何变化</h4>
        </div>
        {state.kind === "error" ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setState({ kind: "loading" });
              setReloadToken((current) => current + 1);
            }}
          >
            重新读取
          </button>
        ) : null}
      </div>

      {state.kind === "loading" ? (
        <p className="task-history-status" aria-live="polite">
          正在读取变化历史…
        </p>
      ) : null}

      {state.kind === "error" ? (
        <div className="error-detail" role="alert">
          <p>{state.error.message}</p>
          <p>{state.error.action}</p>
        </div>
      ) : null}

      {state.kind === "ready" && state.changes.length === 0 ? (
        <p className="task-history-status">暂无变化历史。</p>
      ) : null}

      {state.kind === "ready" && state.changes.length > 0 ? (
        <ol className="task-history-list">
          {state.changes.map((change) => {
            const details = changeDetails(change, subjectById);
            return (
              <li key={change.id}>
                <div className="task-history-event">
                  <strong>{CHANGE_LABELS[change.changeType]}</strong>
                  <time dateTime={new Date(change.createdAt).toISOString()}>
                    {formatter.format(new Date(change.createdAt))}
                  </time>
                </div>
                {details.length === 0 ? null : (
                  <ul>
                    {details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
