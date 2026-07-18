import { useState } from "react";

import {
  normalizeScheduleCommandError,
  type RescheduleTaskInput,
  type ScheduleCommandError,
  type StudyTask,
} from "../../shared/tauri/scheduleClient";

interface TaskReschedulePanelProps {
  task: StudyTask;
  hasUnsavedDetails: boolean;
  isTransitioning: boolean;
  onDirtyChange: (isDirty: boolean) => void;
  onReschedule: (request: RescheduleTaskInput) => Promise<StudyTask>;
}

export function TaskReschedulePanel({
  task,
  hasUnsavedDetails,
  isTransitioning,
  onDirtyChange,
  onReschedule,
}: TaskReschedulePanelProps) {
  const [plannedDate, setPlannedDate] = useState(task.plannedDate);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<ScheduleCommandError>();
  const canReschedule = task.status === "todo" || task.status === "in_progress";
  const isDirty = plannedDate !== task.plannedDate || reason !== "";

  const handleDateChange = (value: string) => {
    setPlannedDate(value);
    setError(undefined);
    onDirtyChange(value !== task.plannedDate || reason !== "");
  };

  const handleReasonChange = (value: string) => {
    setReason(value);
    setError(undefined);
    onDirtyChange(plannedDate !== task.plannedDate || value !== "");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (hasUnsavedDetails) {
      setError({
        code: "UNSAVED_TASK_DETAILS",
        message: "任务详情还有未保存的修改。",
        action: "先保存任务详情，再调整计划日期。",
      });
      return;
    }
    const normalizedReason = reason.trim();
    if (
      plannedDate === "" ||
      plannedDate === task.plannedDate ||
      normalizedReason === "" ||
      Array.from(normalizedReason).length > 500
    ) {
      setError({
        code: "SCHEDULE_INPUT_INVALID",
        message: "延期日期或原因不符合要求。",
        action: "选择不同日期，并填写 1 到 500 个字符的原因。",
      });
      return;
    }
    setIsSubmitting(true);
    setError(undefined);
    try {
      const changed = await onReschedule({
        plannedDate,
        reason: normalizedReason,
      });
      setPlannedDate(changed.plannedDate);
      setReason("");
      onDirtyChange(false);
      setIsSubmitting(false);
    } catch (cause: unknown) {
      setError(normalizeScheduleCommandError(cause));
      setIsSubmitting(false);
    }
  };

  const unavailableMessage =
    task.status === "done"
      ? "已完成任务需要先重新打开，才能调整日期。"
      : task.status === "canceled"
        ? "已取消任务需要先恢复，才能调整日期。"
        : undefined;

  return (
    <section className="task-reschedule" aria-labelledby="reschedule-title">
      <p className="section-label">延期</p>
      <h4 id="reschedule-title">调整计划日期</h4>
      <p className="task-reschedule-note">
        只修改计划日期；原日期、新日期和原因会进入只读历史。
      </p>

      {unavailableMessage === undefined ? null : (
        <p className="task-reschedule-unavailable">{unavailableMessage}</p>
      )}

      <form onSubmit={(event) => void handleSubmit(event)}>
        <label>
          新计划日期
          <input
            type="date"
            required
            value={plannedDate}
            disabled={!canReschedule || isSubmitting || isTransitioning}
            onChange={(event) => handleDateChange(event.target.value)}
          />
        </label>
        <label>
          调整原因
          <textarea
            maxLength={500}
            rows={3}
            required
            value={reason}
            disabled={!canReschedule || isSubmitting || isTransitioning}
            placeholder="例如：先补齐前置章节，明天继续"
            onChange={(event) => handleReasonChange(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="secondary-button"
          disabled={
            !canReschedule ||
            isSubmitting ||
            isTransitioning ||
            !isDirty ||
            plannedDate === task.plannedDate ||
            reason.trim() === ""
          }
        >
          {isSubmitting ? "正在调整…" : "确认延期"}
        </button>
      </form>

      {error === undefined ? null : (
        <div className="error-detail" role="alert">
          <p>{error.message}</p>
          <p>{error.action}</p>
        </div>
      )}
    </section>
  );
}
