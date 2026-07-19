import { useState } from "react";

import { RecycleBinPanel } from "./RecycleBinPanel";
import { StudySessionPanel } from "./StudySessionPanel";
import { StudyStatisticsPanel } from "./StudyStatisticsPanel";
import { WeekSchedulePanel } from "./WeekSchedulePanel";

type OverviewView = "week" | "sessions" | "statistics" | "trash";

const VIEWS: ReadonlyArray<{ id: OverviewView; label: string }> = [
  { id: "week", label: "周日程与逾期" },
  { id: "sessions", label: "实际学习记录" },
  { id: "statistics", label: "学习统计" },
  { id: "trash", label: "回收站" },
];

export function ScheduleOverviewPanel() {
  const [view, setView] = useState<OverviewView>("week");

  return (
    <section className="planning-card" aria-labelledby="planning-title">
      <div className="planning-heading">
        <div>
          <p className="section-label">M2 · 计划与执行总览</p>
          <h2 id="planning-title">从一周安排看到真实执行</h2>
          <p>
            周视图、逾期入口、实际学习记录、统计和回收站共用同一份本地数据。
          </p>
        </div>
      </div>
      <div className="planning-tabs" role="tablist" aria-label="计划总览功能">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            className={
              view === item.id ? "planning-tab-active" : "secondary-button"
            }
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="planning-view" role="tabpanel">
        {view === "week" ? <WeekSchedulePanel /> : null}
        {view === "sessions" ? <StudySessionPanel /> : null}
        {view === "statistics" ? <StudyStatisticsPanel /> : null}
        {view === "trash" ? <RecycleBinPanel /> : null}
      </div>
    </section>
  );
}
