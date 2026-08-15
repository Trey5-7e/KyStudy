import { SectionHeader } from "../../shared/ui/SectionHeader";
import { formatOverviewNumber } from "./todayOverviewModel";

interface TodayProgressSectionProps {
  progressCompleted: number;
  progressTotal: number;
  progressPercent: number;
  skippedCycles: number;
}

export function TodayProgressSection({
  progressCompleted,
  progressTotal,
  progressPercent,
  skippedCycles,
}: TodayProgressSectionProps) {
  return (
    <section className="today-progress" aria-labelledby="today-progress-title">
      <SectionHeader
        id="today-progress-title"
        title="今日进度"
        description={`${formatOverviewNumber(progressCompleted)} / ${formatOverviewNumber(progressTotal)} 项完成`}
      />
      <div
        className="today-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.max(1, progressTotal)}
        aria-valuenow={progressCompleted}
        aria-label="今日学习进度"
      >
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="today-progress-meta">
        <span>{formatOverviewNumber(progressPercent)}% 完成</span>
        <span>已跳过 {formatOverviewNumber(skippedCycles)} 项</span>
      </div>
    </section>
  );
}
