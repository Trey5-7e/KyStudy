import { useMemo, useState, type RefObject } from "react";

import { PageEmpty, PageSurface } from "../../shared/components/PagePrimitives";
import type {
  CyclePlanDashboard,
  CyclePlanItem,
  CyclePlanItemState,
  CyclePlanOverview,
} from "../../shared/tauri/cyclePlanClient";
import {
  cyclePlanItemActions,
  cyclePlanItemStateLabel,
} from "./cyclePlanItemActions";
import {
  changeMonth,
  eventsForDate,
  formatFullDate,
  formatMonth,
  formatShortDate,
  monthCells,
  WEEKDAYS,
} from "./cyclePlanViewModel";

function CycleRestDays({
  values: initialValues,
  busy,
  onSave,
}: {
  values: number[];
  busy: boolean;
  onSave(values: number[]): Promise<boolean>;
}) {
  const [values, setValues] = useState(initialValues);
  return (
    <details className="cycle-rest-days">
      <summary>
        <span>
          <strong>每周休息日</strong>
          <small>
            {initialValues.length === 0
              ? "未设置"
              : initialValues.map((value) => WEEKDAYS[value]).join("、")}
          </small>
        </span>
      </summary>
      <p>设置一次，周期计划与错题都会自动跳过。</p>
      <fieldset disabled={busy}>
        <legend className="sr-only">选择每周休息日</legend>
        {WEEKDAYS.map((weekday, index) => (
          <label key={weekday}>
            <input
              name={`cycle-rest-${index}`}
              type="checkbox"
              disabled={busy}
              checked={values.includes(index)}
              onChange={(event) =>
                setValues((current) =>
                  event.target.checked
                    ? [...current, index].sort((left, right) => left - right)
                    : current.filter((value) => value !== index),
                )
              }
            />
            {weekday}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        disabled={busy || values.length >= 7}
        onClick={() => void onSave(values)}
      >
        保存休息日
      </button>
    </details>
  );
}

function MonthCalendar({
  year,
  month,
  today,
  selectedDate,
  plans,
  onSelectDate,
  onPrevious,
  onNext,
  onToday,
}: {
  year: number;
  month: number;
  today: string;
  selectedDate: string;
  plans: CyclePlanOverview[];
  onSelectDate(value: string): void;
  onPrevious(): void;
  onNext(): void;
  onToday(): void;
}) {
  const cells = useMemo(() => monthCells(year, month), [month, year]);
  return (
    <section className="cycle-calendar" aria-labelledby="cycle-calendar-title">
      <header>
        <div>
          <p className="section-label">月历</p>
          <h3 id="cycle-calendar-title">{formatMonth(year, month)}</h3>
        </div>
        <div className="cycle-calendar-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onPrevious}
            aria-label="上个月"
          >
            ‹
          </button>
          <button type="button" className="secondary-button" onClick={onToday}>
            今天
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onNext}
            aria-label="下个月"
          >
            ›
          </button>
        </div>
      </header>
      <div className="cycle-calendar-weekdays" role="row">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday} role="columnheader">
            {weekday.slice(1)}
          </span>
        ))}
      </div>
      <div
        className="cycle-calendar-grid"
        role="grid"
        aria-labelledby="cycle-calendar-title"
      >
        {Array.from({ length: Math.ceil(cells.length / 7) }, (_, weekIndex) => (
          <div
            key={cells[weekIndex * 7]?.date ?? weekIndex}
            className="cycle-calendar-row"
            role="row"
          >
            {cells.slice(weekIndex * 7, weekIndex * 7 + 7).map((cell) => {
              const events = eventsForDate(plans, cell.date);
              return (
                <div
                  key={cell.date}
                  role="gridcell"
                  aria-selected={cell.date === selectedDate}
                  className={`cycle-calendar-day${cell.currentMonth ? "" : " cycle-calendar-muted"}${cell.date === today ? " cycle-calendar-today" : ""}${cell.date === selectedDate ? " cycle-calendar-selected" : ""}`}
                >
                  <button
                    type="button"
                    className="cycle-calendar-date"
                    aria-label={formatFullDate(cell.date)}
                    aria-pressed={cell.date === selectedDate}
                    onClick={() => onSelectDate(cell.date)}
                  >
                    {cell.day}
                  </button>
                  <div className="cycle-calendar-events">
                    {events.slice(0, 3).map(({ overview, item }) => (
                      <button
                        key={item.id}
                        type="button"
                        className={
                          item.state === "completed"
                            ? "cycle-event-completed"
                            : undefined
                        }
                        aria-label={`${overview.plan.name}第 ${item.unitIndex} ${overview.plan.unitLabel}，${cyclePlanItemStateLabel(item.state)}`}
                        title={`${overview.plan.name} · 第 ${item.unitIndex} ${overview.plan.unitLabel} · ${cyclePlanItemStateLabel(item.state)}`}
                        onClick={() => onSelectDate(cell.date)}
                      >
                        {overview.plan.name} {item.unitIndex}
                      </button>
                    ))}
                    {events.length <= 3 ? null : (
                      <span>另有 {events.length - 3} 项</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function CyclePlanCard({
  overview,
  busy,
  onOpen,
}: {
  overview: CyclePlanOverview;
  busy: boolean;
  onOpen(trigger: HTMLButtonElement): void;
}) {
  const plan = overview.plan;
  return (
    <article className="cycle-plan-card">
      <header>
        <div>
          <h4>{plan.name}</h4>
          <p>
            {plan.totalUnits} {plan.unitLabel} · 每 {plan.studyDaysPerUnit}{" "}
            个学习日 1 {plan.unitLabel}
          </p>
        </div>
        <strong>{overview.progressPercent}%</strong>
      </header>
      <progress value={overview.completedCount} max={plan.totalUnits}>
        {overview.progressPercent}%
      </progress>
      <p>
        已完成 {overview.completedCount} / {plan.totalUnits} {plan.unitLabel}
        ，已跳过 {overview.skippedCount} 项，预计{" "}
        {formatShortDate(overview.estimatedEndDate)}
        完成
      </p>
      <div className="cycle-plan-card-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          aria-label={`查看计划：${plan.name}`}
          onClick={(event) => onOpen(event.currentTarget)}
        >
          查看计划
        </button>
      </div>
    </article>
  );
}

export interface CyclePlanCalendarWorkspaceProps {
  dashboard: CyclePlanDashboard;
  today: string;
  selectedDate: string;
  month: { year: number; month: number };
  busy: boolean;
  planHeadingRef: RefObject<HTMLHeadingElement | null>;
  itemActionRefs: RefObject<Map<string, HTMLButtonElement>>;
  openPlan(overview: CyclePlanOverview, trigger: HTMLButtonElement): void;
  setMonth(value: { year: number; month: number }): void;
  setSelectedDate(value: string): void;
  updateCycleItemState(
    item: CyclePlanItem,
    targetState: CyclePlanItemState,
    itemLabel: string,
    trigger: HTMLButtonElement,
  ): Promise<void>;
  run(
    operation: () => Promise<CyclePlanDashboard>,
    success: string,
  ): Promise<boolean>;
  setReviewRestWeekdays(values: number[], today: string): Promise<unknown>;
  getCyclePlanDashboard(): Promise<CyclePlanDashboard>;
}

export function CyclePlanCalendarWorkspace({
  dashboard,
  today,
  selectedDate,
  month,
  busy,
  planHeadingRef,
  itemActionRefs,
  openPlan,
  setMonth,
  setSelectedDate,
  updateCycleItemState,
  run,
  setReviewRestWeekdays,
  getCyclePlanDashboard,
}: CyclePlanCalendarWorkspaceProps) {
  const plans = dashboard.plans;
  const selectedItems = eventsForDate(plans, selectedDate);
  return (
    <>
      <div className="cycle-plan-layout">
        <MonthCalendar
          year={month.year}
          month={month.month}
          today={today}
          selectedDate={selectedDate}
          plans={plans}
          onSelectDate={setSelectedDate}
          onPrevious={() => setMonth(changeMonth(month, -1))}
          onNext={() => setMonth(changeMonth(month, 1))}
          onToday={() => {
            const now = new Date();
            setMonth({ year: now.getFullYear(), month: now.getMonth() });
            setSelectedDate(today);
          }}
        />

        <aside className="cycle-calendar-sidebar">
          <section
            className="cycle-day-detail"
            aria-labelledby="cycle-day-title"
          >
            <div className="cycle-day-heading">
              <div>
                <p className="section-label">选中日期</p>
                <h3 id="cycle-day-title">{formatFullDate(selectedDate)}</h3>
              </div>
              <span>{selectedItems.length} 项</span>
            </div>
            {selectedItems.length === 0 ? (
              <p className="cycle-day-empty">这一天没有周期事项。</p>
            ) : (
              <ul>
                {selectedItems.map(({ overview, item }) => {
                  const itemLabel = `${overview.plan.name}第 ${item.unitIndex} ${overview.plan.unitLabel}`;
                  return (
                    <li key={item.id}>
                      <div
                        className={
                          item.state === "completed"
                            ? "cycle-item-completed"
                            : undefined
                        }
                      >
                        <strong>{overview.plan.name}</strong>
                        <span>
                          第 {item.unitIndex} {overview.plan.unitLabel} ·{" "}
                          {formatShortDate(item.plannedStartDate)}
                          {item.plannedStartDate === item.plannedEndDate
                            ? ""
                            : ` 至 ${formatShortDate(item.plannedEndDate)}`}
                        </span>
                        <span>{cyclePlanItemStateLabel(item.state)}</span>
                        <div className="cycle-plan-card-actions">
                          {cyclePlanItemActions(item.state).map(
                            (action, index) => (
                              <button
                                key={action.targetState}
                                ref={
                                  index === 0
                                    ? (node) => {
                                        if (node === null) {
                                          itemActionRefs.current.delete(
                                            item.id,
                                          );
                                        } else {
                                          itemActionRefs.current.set(
                                            item.id,
                                            node,
                                          );
                                        }
                                      }
                                    : undefined
                                }
                                type="button"
                                className="secondary-button"
                                disabled={busy}
                                aria-label={`${action.label}：${itemLabel}`}
                                onClick={(event) =>
                                  void updateCycleItemState(
                                    item,
                                    action.targetState,
                                    itemLabel,
                                    event.currentTarget,
                                  )
                                }
                              >
                                {action.label}
                              </button>
                            ),
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {dashboard === undefined ? null : (
            <CycleRestDays
              key={dashboard.restWeekdays.join(",")}
              values={dashboard.restWeekdays}
              busy={busy}
              onSave={(values) =>
                run(async () => {
                  await setReviewRestWeekdays(values, today);
                  return getCyclePlanDashboard();
                }, "每周休息日已保存，周期计划与错题都会自动跳过。")
              }
            />
          )}
        </aside>
      </div>

      <PageSurface
        className="cycle-plan-list"
        labelledBy="cycle-plan-list-title"
      >
        <div className="cycle-plan-list-heading">
          <div>
            <h3 ref={planHeadingRef} id="cycle-plan-list-title" tabIndex={-1}>
              周期计划
            </h3>
            <p>
              休息日：
              {dashboard?.restWeekdays.length === 0
                ? "无"
                : dashboard?.restWeekdays
                    .map((value) => WEEKDAYS[value])
                    .join("、")}
            </p>
          </div>
        </div>
        {plans.length === 0 ? (
          <PageEmpty
            className="cycle-plan-empty"
            headingLevel={3}
            title="还没有周期计划"
            description="只填 6 个核心信息即可生成完整日期。"
          />
        ) : (
          <div className="cycle-plan-cards">
            {plans.map((overview) => (
              <CyclePlanCard
                key={overview.plan.id}
                overview={overview}
                busy={busy}
                onOpen={(trigger) => openPlan(overview, trigger)}
              />
            ))}
          </div>
        )}
      </PageSurface>
    </>
  );
}
