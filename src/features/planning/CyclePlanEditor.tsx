import { useMemo, type FormEvent } from "react";

import { previewCycleSchedule } from "./cycleCalendar";
import { CyclePlanAiAssistant } from "./CyclePlanAiAssistant";
import { formatShortDate, type CyclePlanDraft } from "./cyclePlanViewModel";
import type { CycleScheduleMode } from "../../shared/tauri/cyclePlanClient";

export function CyclePlanEditor({
  draft,
  restWeekdays,
  busy,
  onChange,
  onSave,
}: {
  draft: CyclePlanDraft;
  restWeekdays: number[];
  busy: boolean;
  onChange(value: CyclePlanDraft): void;
  onSave(value: CyclePlanDraft): Promise<void>;
}) {
  const valid =
    draft.name.trim() !== "" &&
    Number.isInteger(Number(draft.totalUnits)) &&
    Number(draft.totalUnits) > 0 &&
    draft.unitLabel.trim() !== "" &&
    draft.startDate !== "" &&
    draft.deadline >= draft.startDate &&
    Number.isInteger(Number(draft.studyDaysPerUnit)) &&
    Number(draft.studyDaysPerUnit) > 0;
  const preview = useMemo(() => {
    if (!valid) {
      return undefined;
    }
    return previewCycleSchedule({
      startDate: draft.startDate,
      deadline: draft.deadline,
      totalUnits: Number(draft.totalUnits),
      studyDaysPerUnit: Number(draft.studyDaysPerUnit),
      scheduleMode: draft.scheduleMode,
      restWeekdays,
    });
  }, [
    draft.deadline,
    draft.scheduleMode,
    draft.startDate,
    draft.studyDaysPerUnit,
    draft.totalUnits,
    restWeekdays,
    valid,
  ]);
  return (
    <form
      className="cycle-plan-form"
      onSubmit={(event: FormEvent) => event.preventDefault()}
    >
      <fieldset className="cycle-form-section cycle-form-goal">
        <legend>目标</legend>
        <div className="cycle-plan-form-grid">
          <label className="cycle-field-wide">
            计划名称
            <input
              name="cycle-plan-name"
              autoComplete="off"
              required
              maxLength={120}
              placeholder="例如：数学模拟卷…"
              disabled={busy}
              value={draft.name}
              onChange={(event) =>
                onChange({ ...draft, name: event.target.value })
              }
            />
          </label>
          <label>
            总数量
            <input
              name="cycle-plan-total"
              type="number"
              inputMode="numeric"
              autoComplete="off"
              min="1"
              max="500"
              disabled={busy}
              value={draft.totalUnits}
              onChange={(event) =>
                onChange({ ...draft, totalUnits: event.target.value })
              }
            />
          </label>
          <label>
            单位
            <input
              name="cycle-plan-unit"
              autoComplete="off"
              maxLength={20}
              placeholder="例如：套…"
              disabled={busy}
              value={draft.unitLabel}
              onChange={(event) =>
                onChange({ ...draft, unitLabel: event.target.value })
              }
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="cycle-form-section">
        <legend>日期与节奏</legend>
        <div className="cycle-plan-form-grid">
          <label>
            开始日期
            <input
              name="cycle-plan-start"
              type="date"
              autoComplete="off"
              disabled={busy}
              value={draft.startDate}
              onChange={(event) =>
                onChange({ ...draft, startDate: event.target.value })
              }
            />
          </label>
          <label>
            截止日期
            <input
              name="cycle-plan-deadline"
              type="date"
              autoComplete="off"
              min={draft.startDate}
              disabled={busy}
              value={draft.deadline}
              onChange={(event) =>
                onChange({ ...draft, deadline: event.target.value })
              }
            />
          </label>
          <label>
            完成 1 个单位需要
            <input
              name="cycle-plan-study-days"
              type="number"
              inputMode="numeric"
              autoComplete="off"
              min="1"
              max="30"
              disabled={busy}
              value={draft.studyDaysPerUnit}
              onChange={(event) =>
                onChange({ ...draft, studyDaysPerUnit: event.target.value })
              }
            />
          </label>
          <label className="cycle-field-wide">
            排程方式
            <select
              name="cycle-plan-mode"
              autoComplete="off"
              disabled={busy}
              value={draft.scheduleMode}
              onChange={(event) =>
                onChange({
                  ...draft,
                  scheduleMode: event.target.value as CycleScheduleMode,
                })
              }
            >
              <option value="rhythm">保持节奏，允许提示超期</option>
              <option value="even">均匀分布到截止日</option>
            </select>
          </label>
        </div>
        <label className="cycle-calendar-checkbox">
          <input
            name="cycle-plan-calendar-visible"
            type="checkbox"
            disabled={busy}
            checked={draft.calendarVisible}
            onChange={(event) =>
              onChange({ ...draft, calendarVisible: event.target.checked })
            }
          />
          显示在月历
        </label>
      </fieldset>

      {draft.planId === undefined ? (
        <CyclePlanAiAssistant
          current={draft}
          onAccept={(value) => onChange({ ...draft, ...value })}
        />
      ) : null}
      <p className="cycle-plan-form-note">
        每周休息日沿用计划页设置；生成后不需要逐日添加任务。
      </p>
      <section
        className="cycle-plan-preview"
        aria-labelledby="cycle-plan-preview-title"
      >
        <div className="cycle-plan-preview-heading">
          <div>
            <p className="section-label">保存前检查</p>
            <h3 id="cycle-plan-preview-title">排程预览</h3>
          </div>
          <span>{preview?.items.length ?? 0} 个单位</span>
        </div>
        <div
          className="cycle-plan-preview-status"
          role="status"
          aria-live="polite"
        >
          {!valid ? (
            <p>填写完整信息后查看日期预览。</p>
          ) : preview === undefined ? (
            <p>当前设置无法生成日期预览，请检查日期和节奏。</p>
          ) : (
            <>
              <p>
                预计 {formatShortDate(preview.estimatedEndDate)} 完成，共{" "}
                {preview.items.length} 个单位。
              </p>
              {preview.exceedsDeadline ? (
                <p className="cycle-plan-preview-warning">
                  <strong>预计超期：</strong>
                  将超过截止日期 {formatShortDate(draft.deadline)}。
                </p>
              ) : (
                <p>预计在截止日期 {formatShortDate(draft.deadline)} 内完成。</p>
              )}
            </>
          )}
        </div>
        {preview === undefined ? null : (
          <ol className="cycle-plan-preview-list" aria-label="单位日期范围">
            {preview.items.map((item) => (
              <li key={item.unitIndex}>
                <span>
                  第 {item.unitIndex} {draft.unitLabel.trim() || "单位"}
                </span>
                <span>
                  {formatShortDate(item.plannedStartDate)} 至{" "}
                  {formatShortDate(item.plannedEndDate)}
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className="cycle-plan-form-actions">
          <button
            type="button"
            disabled={busy || !valid || preview === undefined}
            onClick={() => {
              if (valid && preview !== undefined) {
                void onSave(draft);
              }
            }}
          >
            确认排程并保存
          </button>
        </div>
      </section>
    </form>
  );
}
