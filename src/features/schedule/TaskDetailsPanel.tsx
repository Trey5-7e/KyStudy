import { useState } from "react";

import {
  normalizeScheduleCommandError,
  type ScheduleCommandError,
  type StudySubject,
  type StudyTask,
  type TaskPriority,
  type TaskTransition,
  type UpdateTaskDetailsInput,
} from "../../shared/tauri/scheduleClient";

const STATUS_LABELS = {
  todo: "待开始",
  in_progress: "学习中",
  done: "已完成",
  canceled: "已取消",
} as const;

interface TaskDetailsPanelProps {
  task: StudyTask;
  subjects: StudySubject[];
  onClose: () => void;
  onSave: (request: UpdateTaskDetailsInput) => Promise<StudyTask>;
  onTransition: (transition: TaskTransition) => Promise<void>;
}

export function TaskDetailsPanel({
  task,
  subjects,
  onClose,
  onSave,
  onTransition,
}: TaskDetailsPanelProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [subjectId, setSubjectId] = useState(task.subjectId ?? "");
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    task.estimatedMinutes?.toString() ?? "",
  );
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<TaskTransition>();
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState<ScheduleCommandError>();
  const hasUnsavedChanges =
    title !== task.title ||
    description !== (task.description ?? "") ||
    subjectId !== (task.subjectId ?? "") ||
    estimatedMinutes !== (task.estimatedMinutes?.toString() ?? "") ||
    priority !== task.priority;
  const selectableSubjects = subjects.filter(
    (subject) =>
      subject.archivedAt === undefined || subject.id === task.subjectId,
  );

  const updateForm = (update: () => void) => {
    update();
    setConfirmClose(false);
    setError(undefined);
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedMinutes =
      estimatedMinutes === "" ? undefined : Number(estimatedMinutes);
    if (
      parsedMinutes !== undefined &&
      (!Number.isSafeInteger(parsedMinutes) ||
        parsedMinutes < 1 ||
        parsedMinutes > 1440)
    ) {
      setError({
        code: "SCHEDULE_INPUT_INVALID",
        message: "预计时长需要在 1 到 1440 分钟之间。",
        action: "修改预计时长后再保存。",
      });
      return;
    }
    setIsSaving(true);
    setError(undefined);
    const request: UpdateTaskDetailsInput = {
      ...(subjectId === "" ? {} : { subjectId }),
      title,
      ...(description.trim() === "" ? {} : { description }),
      ...(parsedMinutes === undefined
        ? {}
        : { estimatedMinutes: parsedMinutes }),
      priority,
    };
    try {
      const saved = await onSave(request);
      setTitle(saved.title);
      setDescription(saved.description ?? "");
      setSubjectId(saved.subjectId ?? "");
      setEstimatedMinutes(saved.estimatedMinutes?.toString() ?? "");
      setPriority(saved.priority);
      setIsSaving(false);
    } catch (reason: unknown) {
      setError(normalizeScheduleCommandError(reason));
      setIsSaving(false);
    }
  };

  const handleTransition = async (transition: TaskTransition) => {
    if (hasUnsavedChanges) {
      setError({
        code: "UNSAVED_TASK_DETAILS",
        message: "任务详情还有未保存的修改。",
        action: "先保存修改，再执行状态操作。",
      });
      return;
    }
    setPendingTransition(transition);
    setError(undefined);
    try {
      await onTransition(transition);
      setPendingTransition(undefined);
    } catch (reason: unknown) {
      setError(normalizeScheduleCommandError(reason));
      setPendingTransition(undefined);
    }
  };

  const requestClose = () => {
    if (hasUnsavedChanges) {
      setConfirmClose(true);
      return;
    }
    onClose();
  };

  return (
    <aside className="task-details" aria-labelledby="task-details-title">
      <div className="task-details-heading">
        <div>
          <p className="section-label">任务详情</p>
          <h3 id="task-details-title">编辑任务</h3>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={requestClose}
        >
          关闭
        </button>
      </div>

      {confirmClose ? (
        <div className="discard-warning" role="alert">
          <p>尚有未保存修改，关闭后会丢失。</p>
          <div>
            <button type="button" className="danger-button" onClick={onClose}>
              放弃修改并关闭
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setConfirmClose(false)}
            >
              继续编辑
            </button>
          </div>
        </div>
      ) : null}

      <dl className="task-metadata">
        <div>
          <dt>计划日期</dt>
          <dd>{task.plannedDate}</dd>
        </div>
        <div>
          <dt>当前状态</dt>
          <dd>{STATUS_LABELS[task.status]}</dd>
        </div>
      </dl>
      <p className="task-date-note">
        计划日期在这里保持只读；调整日期将在“延期”流程中记录原日期和原因。
      </p>

      <form
        className="task-details-form"
        onSubmit={(event) => void handleSave(event)}
      >
        <label>
          标题
          <input
            type="text"
            maxLength={120}
            required
            disabled={isSaving || pendingTransition !== undefined}
            value={title}
            onChange={(event) => updateForm(() => setTitle(event.target.value))}
          />
        </label>
        <label>
          说明
          <textarea
            maxLength={2000}
            rows={5}
            disabled={isSaving || pendingTransition !== undefined}
            value={description}
            placeholder="可选：记录范围、完成标准或注意事项"
            onChange={(event) =>
              updateForm(() => setDescription(event.target.value))
            }
          />
        </label>
        <div className="task-details-row">
          <label>
            科目
            <select
              value={subjectId}
              disabled={isSaving || pendingTransition !== undefined}
              onChange={(event) =>
                updateForm(() => setSubjectId(event.target.value))
              }
            >
              <option value="">未分类</option>
              {selectableSubjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                  {subject.archivedAt === undefined ? "" : "（已归档，保留）"}
                </option>
              ))}
            </select>
          </label>
          <label>
            预计分钟
            <input
              type="number"
              min={1}
              max={1440}
              disabled={isSaving || pendingTransition !== undefined}
              value={estimatedMinutes}
              placeholder="可选"
              onChange={(event) =>
                updateForm(() => setEstimatedMinutes(event.target.value))
              }
            />
          </label>
          <label>
            优先级
            <select
              value={priority}
              disabled={isSaving || pendingTransition !== undefined}
              onChange={(event) =>
                updateForm(() =>
                  setPriority(event.target.value as TaskPriority),
                )
              }
            >
              <option value="normal">普通</option>
              <option value="high">高优先</option>
              <option value="low">低优先</option>
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={isSaving || !hasUnsavedChanges || title.trim() === ""}
        >
          {isSaving ? "正在保存…" : "保存详情"}
        </button>
      </form>

      {error === undefined ? null : (
        <div className="error-detail" role="alert">
          <p>{error.message}</p>
          <p>{error.action}</p>
        </div>
      )}

      <div className="task-lifecycle-actions" aria-label="任务状态操作">
        {task.status === "todo" ? (
          <button
            type="button"
            disabled={pendingTransition !== undefined}
            onClick={() => void handleTransition("start")}
          >
            {pendingTransition === "start" ? "正在开始…" : "开始学习"}
          </button>
        ) : null}
        {task.status === "todo" || task.status === "in_progress" ? (
          <button
            type="button"
            className="secondary-button"
            disabled={pendingTransition !== undefined}
            onClick={() => void handleTransition("complete")}
          >
            {pendingTransition === "complete" ? "正在完成…" : "标记完成"}
          </button>
        ) : null}
        {task.status === "done" ? (
          <button
            type="button"
            className="secondary-button"
            disabled={pendingTransition !== undefined}
            onClick={() => void handleTransition("reopen")}
          >
            {pendingTransition === "reopen" ? "正在重新打开…" : "重新打开"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
