import { useState } from "react";

import {
  normalizeScheduleCommandError,
  type RescheduleTaskInput,
  type ScheduleCommandError,
  type SplitTaskInput,
  type StudySubject,
  type StudyTask,
  type TaskSplitResult,
  type TaskPriority,
  type TaskTransition,
  type UpdateTaskDetailsInput,
} from "../../shared/tauri/scheduleClient";
import { TaskHistoryPanel } from "./TaskHistoryPanel";
import { TaskReschedulePanel } from "./TaskReschedulePanel";
import { TaskSplitPanel } from "./TaskSplitPanel";

const STATUS_LABELS = {
  todo: "待开始",
  in_progress: "学习中",
  done: "已完成",
  canceled: "已取消",
} as const;

interface TaskDetailsPanelProps {
  task: StudyTask;
  subjects: StudySubject[];
  timezone: string;
  onClose: () => void;
  onSave: (request: UpdateTaskDetailsInput) => Promise<StudyTask>;
  onTransition: (transition: TaskTransition) => Promise<void>;
  onReschedule: (request: RescheduleTaskInput) => Promise<StudyTask>;
  onSplit: (request: SplitTaskInput) => Promise<TaskSplitResult>;
  onTrash: () => Promise<void>;
}

export function TaskDetailsPanel({
  task,
  subjects,
  timezone,
  onClose,
  onSave,
  onTransition,
  onReschedule,
  onSplit,
  onTrash,
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
  const [hasPendingReschedule, setHasPendingReschedule] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState<ScheduleCommandError>();
  const hasUnsavedChanges =
    title !== task.title ||
    description !== (task.description ?? "") ||
    subjectId !== (task.subjectId ?? "") ||
    estimatedMinutes !== (task.estimatedMinutes?.toString() ?? "") ||
    priority !== task.priority;
  const hasUnsavedWork = hasUnsavedChanges || hasPendingReschedule;
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
    if (hasUnsavedWork) {
      setError({
        code: "UNSAVED_TASK_DETAILS",
        message: "任务详情或延期区域还有未保存的修改。",
        action: "先保存或清除修改，再执行状态操作。",
      });
      return;
    }
    setPendingTransition(transition);
    setError(undefined);
    try {
      await onTransition(transition);
      setConfirmCancel(false);
      setPendingTransition(undefined);
    } catch (reason: unknown) {
      setError(normalizeScheduleCommandError(reason));
      setPendingTransition(undefined);
    }
  };

  const requestClose = () => {
    if (hasUnsavedWork) {
      setConfirmClose(true);
      return;
    }
    onClose();
  };

  const handleTrash = async () => {
    if (hasUnsavedWork) {
      setError({
        code: "UNSAVED_TASK_DETAILS",
        message: "任务详情或延期区域还有未保存的修改。",
        action: "先保存或清除修改，再移入回收站。",
      });
      return;
    }
    setPendingTransition("cancel");
    setError(undefined);
    try {
      await onTrash();
    } catch (reason: unknown) {
      setError(normalizeScheduleCommandError(reason));
      setPendingTransition(undefined);
      setConfirmTrash(false);
    }
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
          <p>详情或延期区域尚有未保存修改，关闭后会丢失。</p>
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
        {task.status === "canceled" ? (
          <button
            type="button"
            disabled={pendingTransition !== undefined}
            onClick={() => void handleTransition("restore")}
          >
            {pendingTransition === "restore" ? "正在恢复…" : "恢复任务"}
          </button>
        ) : null}
        {task.status === "todo" || task.status === "in_progress" ? (
          confirmCancel ? (
            <div className="cancel-confirmation" role="alert">
              <span>取消后仍可恢复，是否继续？</span>
              <button
                type="button"
                className="danger-button"
                disabled={pendingTransition !== undefined}
                onClick={() => void handleTransition("cancel")}
              >
                {pendingTransition === "cancel" ? "正在取消…" : "确认取消"}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={pendingTransition !== undefined}
                onClick={() => setConfirmCancel(false)}
              >
                返回
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="danger-button"
              disabled={pendingTransition !== undefined}
              onClick={() => setConfirmCancel(true)}
            >
              取消任务
            </button>
          )
        ) : null}
      </div>

      <TaskSplitPanel
        task={task}
        disabled={hasUnsavedWork || pendingTransition !== undefined}
        onSplit={onSplit}
      />

      <div className="task-trash-actions">
        {confirmTrash ? (
          <div className="cancel-confirmation" role="alert">
            <span>任务会进入回收站，历史与学习记录不会被删除。</span>
            <button
              type="button"
              className="danger-button"
              disabled={pendingTransition !== undefined}
              onClick={() => void handleTrash()}
            >
              {pendingTransition !== undefined ? "正在移动…" : "确认移入回收站"}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={pendingTransition !== undefined}
              onClick={() => setConfirmTrash(false)}
            >
              返回
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="danger-button"
            disabled={pendingTransition !== undefined}
            onClick={() => setConfirmTrash(true)}
          >
            移入回收站
          </button>
        )}
      </div>

      <TaskReschedulePanel
        task={task}
        hasUnsavedDetails={hasUnsavedChanges}
        isTransitioning={pendingTransition !== undefined}
        onDirtyChange={setHasPendingReschedule}
        onReschedule={onReschedule}
      />

      <TaskHistoryPanel
        taskId={task.id}
        subjects={subjects}
        timezone={timezone}
      />
    </aside>
  );
}
