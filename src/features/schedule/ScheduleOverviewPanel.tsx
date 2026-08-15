import { useRef, useState, type KeyboardEvent } from "react";

import {
  PageHeader,
  PageSurface,
} from "../../shared/components/PagePrimitives";

import { RecycleBinPanel } from "./RecycleBinPanel";
import { StudySessionPanel } from "./StudySessionPanel";
import { StudyStatisticsPanel } from "./StudyStatisticsPanel";
import { WeekSchedulePanel } from "./WeekSchedulePanel";

type OverviewView = "week" | "sessions" | "statistics" | "trash";

export function scheduleOverviewTabIndexAfterKey(
  currentIndex: number,
  key: string,
  tabCount = VIEWS.length,
): number | undefined {
  if (tabCount <= 0) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return tabCount - 1;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return (currentIndex + 1 + tabCount) % tabCount;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return (currentIndex - 1 + tabCount) % tabCount;
  }
  return undefined;
}

const VIEWS: ReadonlyArray<{ id: OverviewView; label: string }> = [
  { id: "week", label: "周日程与逾期" },
  { id: "sessions", label: "实际学习记录" },
  { id: "statistics", label: "学习统计" },
  { id: "trash", label: "回收站" },
];

export function ScheduleOverviewPanel({
  onBackToPlanning,
}: {
  onBackToPlanning(): void;
}) {
  const [view, setView] = useState<OverviewView>("week");
  const tabRefs = useRef(new Map<OverviewView, HTMLButtonElement>());

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    const nextIndex = scheduleOverviewTabIndexAfterKey(currentIndex, event.key);
    if (nextIndex === undefined) return;
    const nextView = VIEWS[nextIndex]?.id;
    if (nextView === undefined) return;
    event.preventDefault();
    setView(nextView);
    requestAnimationFrame(() => {
      tabRefs.current.get(nextView)?.focus({ preventScroll: true });
    });
  };

  return (
    <section
      className="schedule-overview-page"
      aria-labelledby="schedule-overview-title"
    >
      <PageHeader
        id="schedule-overview-title"
        eyebrow="历史详细日程"
        title="已有日程"
        description="查看已生成的周日程、学习记录、统计和回收站。"
        backAction={
          <button
            type="button"
            className="secondary-button"
            onClick={onBackToPlanning}
          >
            返回计划
          </button>
        }
      />
      <PageSurface as="div" className="planning-card schedule-overview-surface">
        <div
          className="planning-tabs"
          role="tablist"
          aria-label="已有日程功能"
          aria-orientation="horizontal"
        >
          {VIEWS.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                if (element === null) {
                  tabRefs.current.delete(item.id);
                } else {
                  tabRefs.current.set(item.id, element);
                }
              }}
              id={`schedule-overview-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={view === item.id}
              aria-controls={`schedule-overview-panel-${item.id}`}
              tabIndex={view === item.id ? 0 : -1}
              className={
                view === item.id ? "planning-tab-active" : "secondary-button"
              }
              onClick={() => setView(item.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div
          id={`schedule-overview-panel-${view}`}
          className="planning-view"
          role="tabpanel"
          aria-labelledby={`schedule-overview-tab-${view}`}
          tabIndex={0}
        >
          {view === "week" ? <WeekSchedulePanel /> : null}
          {view === "sessions" ? <StudySessionPanel /> : null}
          {view === "statistics" ? <StudyStatisticsPanel /> : null}
          {view === "trash" ? <RecycleBinPanel /> : null}
        </div>
      </PageSurface>
    </section>
  );
}
