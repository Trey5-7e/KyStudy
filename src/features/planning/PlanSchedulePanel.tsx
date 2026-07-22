import { useState, type FormEvent } from "react";

import {
  confirmPlanStageTasks,
  normalizePlanScheduleError,
  previewPlanStageTasks,
  type PlanTaskPreview,
  type PlanTaskScheduleInput,
} from "../../shared/tauri/planScheduleClient";
import type { PlanStage, StudyPlan } from "../../shared/tauri/planningClient";
import type {
  ScheduleCommandError,
  StudySubject,
  TaskPriority,
} from "../../shared/tauri/scheduleClient";

const WEEKDAYS = [
  { value: 0, label: "周一" },
  { value: 1, label: "周二" },
  { value: 2, label: "周三" },
  { value: 3, label: "周四" },
  { value: 4, label: "周五" },
  { value: 5, label: "周六" },
  { value: 6, label: "周日" },
] as const;

interface ScheduleForm {
  stageId: string;
  subjectId: string;
  startDate: string;
  endDate: string;
  weekdays: number[];
  title: string;
  description: string;
  estimatedMinutes: string;
  priority: TaskPriority;
}

interface PreviewState {
  request: PlanTaskScheduleInput;
  value: PlanTaskPreview;
}

interface PlanSchedulePanelProps {
  plan: StudyPlan;
  stages: PlanStage[];
  subjects: StudySubject[];
  onOpenSchedule(): void;
  onTasksCreated(): void;
}

export function PlanSchedulePanel({
  plan,
  stages,
  subjects,
  onOpenSchedule,
  onTasksCreated,
}: PlanSchedulePanelProps) {
  const [form, setForm] = useState<ScheduleForm>(() => defaultForm(stages[0]));
  const [preview, setPreview] = useState<PreviewState>();
  const [createdCount, setCreatedCount] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ScheduleCommandError>();
  const activeSubjects = subjects.filter(
    (subject) => subject.archivedAt === undefined,
  );
  const selectedStage = stages.find((stage) => stage.id === form.stageId);
  const canPreview =
    plan.status === "active" &&
    selectedStage !== undefined &&
    form.weekdays.length > 0;

  const updateForm = (update: Partial<ScheduleForm>) => {
    setForm((current) => ({ ...current, ...update }));
    setPreview(undefined);
    setCreatedCount(undefined);
    setError(undefined);
  };

  const chooseStage = (stageId: string) => {
    const stage = stages.find((candidate) => candidate.id === stageId);
    setForm(defaultForm(stage));
    setPreview(undefined);
    setCreatedCount(undefined);
    setError(undefined);
  };

  const requestFromForm = (): PlanTaskScheduleInput => ({
    stageId: form.stageId,
    subjectId: form.subjectId === "" ? undefined : form.subjectId,
    startDate: form.startDate,
    endDate: form.endDate,
    weekdays: form.weekdays,
    title: form.title,
    description: form.description.trim() === "" ? undefined : form.description,
    estimatedMinutes:
      form.estimatedMinutes === "" ? undefined : Number(form.estimatedMinutes),
    priority: form.priority,
  });

  const loadPreview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request = requestFromForm();
    setBusy(true);
    setError(undefined);
    setCreatedCount(undefined);
    try {
      setPreview({ request, value: await previewPlanStageTasks(request) });
    } catch (previewError: unknown) {
      setPreview(undefined);
      setError(normalizePlanScheduleError(previewError));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (preview === undefined || preview.value.createCount === 0) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const creation = await confirmPlanStageTasks(preview.request);
      setCreatedCount(creation.createdTasks.length);
      setPreview({
        request: preview.request,
        value: await previewPlanStageTasks(preview.request),
      });
      if (creation.createdTasks.length > 0) {
        onTasksCreated();
      }
    } catch (confirmError: unknown) {
      setError(normalizePlanScheduleError(confirmError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="plan-subsection plan-schedule"
      aria-labelledby="plan-schedule-title"
    >
      <div className="plan-schedule-heading">
        <h3 id="plan-schedule-title">展开到日程</h3>
        {createdCount === undefined ? null : (
          <button
            type="button"
            className="secondary-button"
            onClick={onOpenSchedule}
          >
            查看日程
          </button>
        )}
      </div>

      {plan.status !== "active" ? (
        <p className="planning-note">请先将这份计划确认为当前计划。</p>
      ) : stages.length === 0 ? (
        <p className="planning-note">请先添加至少一个计划阶段。</p>
      ) : (
        <>
          <form
            className="plan-schedule-form"
            onSubmit={(event) => void loadPreview(event)}
          >
            <label>
              计划阶段
              <select
                value={form.stageId}
                onChange={(event) => chooseStage(event.target.value)}
              >
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              科目
              <select
                value={form.subjectId}
                onChange={(event) =>
                  updateForm({ subjectId: event.target.value })
                }
              >
                <option value="">未分类</option>
                {activeSubjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              开始日期
              <input
                required
                type="date"
                min={selectedStage?.startDate}
                max={selectedStage?.endDate}
                value={form.startDate}
                onChange={(event) =>
                  updateForm({ startDate: event.target.value })
                }
              />
            </label>
            <label>
              结束日期
              <input
                required
                type="date"
                min={selectedStage?.startDate}
                max={selectedStage?.endDate}
                value={form.endDate}
                onChange={(event) =>
                  updateForm({ endDate: event.target.value })
                }
              />
            </label>
            <fieldset className="plan-schedule-weekdays">
              <legend>执行星期</legend>
              {WEEKDAYS.map((weekday) => (
                <label key={weekday.value}>
                  <input
                    type="checkbox"
                    checked={form.weekdays.includes(weekday.value)}
                    onChange={(event) =>
                      updateForm({
                        weekdays: event.target.checked
                          ? [...form.weekdays, weekday.value].sort(
                              (left, right) => left - right,
                            )
                          : form.weekdays.filter(
                              (value) => value !== weekday.value,
                            ),
                      })
                    }
                  />
                  {weekday.label}
                </label>
              ))}
            </fieldset>
            <label className="plan-schedule-wide">
              任务标题
              <input
                required
                maxLength={120}
                value={form.title}
                onChange={(event) => updateForm({ title: event.target.value })}
              />
            </label>
            <label className="plan-schedule-wide">
              任务说明
              <textarea
                rows={3}
                maxLength={2000}
                value={form.description}
                onChange={(event) =>
                  updateForm({ description: event.target.value })
                }
              />
            </label>
            <label>
              每次预计分钟
              <input
                type="number"
                min={1}
                max={1440}
                value={form.estimatedMinutes}
                onChange={(event) =>
                  updateForm({ estimatedMinutes: event.target.value })
                }
              />
            </label>
            <label>
              优先级
              <select
                value={form.priority}
                onChange={(event) =>
                  updateForm({ priority: event.target.value as TaskPriority })
                }
              >
                <option value="low">低</option>
                <option value="normal">普通</option>
                <option value="high">高</option>
              </select>
            </label>
            <button type="submit" disabled={busy || !canPreview}>
              预览任务
            </button>
          </form>

          {error === undefined ? null : (
            <div className="error-detail" role="alert">
              <strong>{error.message}</strong>
              <p>{error.action}</p>
            </div>
          )}

          {createdCount === undefined ? null : (
            <p className="plan-schedule-success" role="status">
              已创建 {createdCount} 项日程任务。
            </p>
          )}

          {preview === undefined ? null : (
            <div className="plan-schedule-preview">
              <div>
                <strong>将新建 {preview.value.createCount} 项</strong>
                <span>已存在 {preview.value.existingCount} 项</span>
              </div>
              <ol>
                {preview.value.items.map((item) => (
                  <li key={item.plannedDate}>
                    <time>{item.plannedDate}</time>
                    <span>{weekdayLabel(item.plannedDate)}</span>
                    <strong>{item.alreadyExists ? "已存在" : "待创建"}</strong>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                disabled={busy || preview.value.createCount === 0}
                onClick={() => void confirm()}
              >
                确认写入日程
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function defaultForm(stage: PlanStage | undefined): ScheduleForm {
  return {
    stageId: stage?.id ?? "",
    subjectId: "",
    startDate: stage?.startDate ?? "",
    endDate: stage?.endDate ?? "",
    weekdays: WEEKDAYS.map((weekday) => weekday.value),
    title: stage?.title ?? "",
    description: stage?.focus ?? "",
    estimatedMinutes: "90",
    priority: "normal",
  };
}

function weekdayLabel(date: string): string {
  const day = new Date(`${date}T00:00:00`).getDay();
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][day] ?? "";
}
