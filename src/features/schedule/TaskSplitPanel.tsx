import { useState } from "react";

import {
  normalizeScheduleCommandError,
  type ScheduleCommandError,
  type SplitTaskInput,
  type StudyTask,
  type TaskSplitResult,
} from "../../shared/tauri/scheduleClient";

interface ChildRow {
  key: number;
  title: string;
  estimatedMinutes: string;
}

interface TaskSplitPanelProps {
  task: StudyTask;
  disabled: boolean;
  onSplit: (request: SplitTaskInput) => Promise<TaskSplitResult>;
}

let nextChildKey = 3;

export function TaskSplitPanel({
  task,
  disabled,
  onSplit,
}: TaskSplitPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<ChildRow[]>([
    { key: 1, title: "", estimatedMinutes: "" },
    { key: 2, title: "", estimatedMinutes: "" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<ScheduleCommandError>();

  if (task.status !== "todo" && task.status !== "in_progress") {
    return null;
  }

  const updateChild = (
    key: number,
    field: "title" | "estimatedMinutes",
    value: string,
  ) => {
    setChildren((current) =>
      current.map((child) =>
        child.key === key ? { ...child, [field]: value } : child,
      ),
    );
    setError(undefined);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) {
      setError({
        code: "UNSAVED_TASK_DETAILS",
        message: "任务详情或延期区域还有未保存的修改。",
        action: "先保存或清除修改，再拆分任务。",
      });
      return;
    }
    const parsed = children.map((child) => ({
      title: child.title,
      minutes:
        child.estimatedMinutes === ""
          ? undefined
          : Number(child.estimatedMinutes),
    }));
    if (
      parsed.some(
        (child) =>
          child.title.trim() === "" ||
          (child.minutes !== undefined &&
            (!Number.isSafeInteger(child.minutes) ||
              child.minutes < 1 ||
              child.minutes > 1440)),
      )
    ) {
      setError({
        code: "SCHEDULE_INPUT_INVALID",
        message: "每个子任务都需要标题，预计时长应为 1～1440 分钟。",
        action: "补全子任务后重试。",
      });
      return;
    }
    setIsSubmitting(true);
    setError(undefined);
    try {
      await onSplit({
        children: parsed.map((child) => ({
          title: child.title,
          ...(child.minutes === undefined
            ? {}
            : { estimatedMinutes: child.minutes }),
        })),
      });
    } catch (reason: unknown) {
      setError(normalizeScheduleCommandError(reason));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="task-split">
      <div className="task-split-heading">
        <div>
          <h4>拆分任务</h4>
          <p>子任务继承当前科目、日期和优先级，父任务会进入“已取消”。</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? "收起" : "开始拆分"}
        </button>
      </div>
      {isOpen ? (
        <form onSubmit={(event) => void submit(event)}>
          {children.map((child, index) => (
            <div className="split-child-row" key={child.key}>
              <label>
                子任务 {index + 1}
                <input
                  type="text"
                  maxLength={120}
                  required
                  disabled={isSubmitting}
                  value={child.title}
                  onChange={(event) =>
                    updateChild(child.key, "title", event.target.value)
                  }
                />
              </label>
              <label>
                预计分钟
                <input
                  type="number"
                  min={1}
                  max={1440}
                  disabled={isSubmitting}
                  value={child.estimatedMinutes}
                  placeholder="可选"
                  onChange={(event) =>
                    updateChild(
                      child.key,
                      "estimatedMinutes",
                      event.target.value,
                    )
                  }
                />
              </label>
              {children.length <= 2 ? null : (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isSubmitting}
                  onClick={() =>
                    setChildren((current) =>
                      current.filter((item) => item.key !== child.key),
                    )
                  }
                >
                  移除
                </button>
              )}
            </div>
          ))}
          <div className="split-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={isSubmitting || children.length >= 20}
              onClick={() => {
                const key = nextChildKey;
                nextChildKey += 1;
                setChildren((current) => [
                  ...current,
                  { key, title: "", estimatedMinutes: "" },
                ]);
              }}
            >
              添加子任务
            </button>
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "正在拆分…" : `确认拆分为 ${children.length} 项`}
            </button>
          </div>
        </form>
      ) : null}
      {error === undefined ? null : (
        <div className="error-detail" role="alert">
          <p>{error.message}</p>
          <p>{error.action}</p>
        </div>
      )}
    </div>
  );
}
