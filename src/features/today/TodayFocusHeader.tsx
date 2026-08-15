import type { ExamCountdown } from "./todayCountdownModel";
import { formatOverviewDate } from "./todayOverviewModel";

interface TodayFocusHeaderProps {
  date: string;
  exam?: ExamCountdown;
}

export function TodayFocusHeader({ date, exam }: TodayFocusHeaderProps) {
  return (
    <header className="today-focus-header">
      <div className="today-focus-heading">
        <p className="today-focus-eyebrow">{formatOverviewDate(date)}</p>
        <h1 id="today-title">今日</h1>
      </div>
      <div className="today-exam-context" aria-label="考试倒计时">
        <div>
          <span>距离考试</span>
          <strong>
            {exam === undefined
              ? "未设置"
              : exam.isToday
                ? "今天"
                : `${exam.daysRemaining} 天`}
          </strong>
        </div>
      </div>
    </header>
  );
}
