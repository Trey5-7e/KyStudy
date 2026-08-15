import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { SectionHeader } from "../../shared/ui/SectionHeader";
import { StatusBanner } from "../../shared/ui/StatusBanner";
import type { ResourceCommandError } from "../../shared/tauri/resourceClient";
import type {
  ReviewSchemeCommandError,
  ReviewSchemeDashboard,
} from "../../shared/tauri/reviewSchemeClient";
import type { ExamCountdown } from "./todayCountdownModel";
import { formatOverviewDate, formatOverviewNumber } from "./todayOverviewModel";

type ReviewScheme = ReviewSchemeDashboard["schemes"][number];
type ReviewTone = "neutral" | "success" | "warning";

interface TodaySupportSectionsProps {
  review?: ReviewSchemeDashboard;
  activeSchemes: readonly ReviewScheme[];
  reviewError?: ReviewSchemeCommandError;
  reviewCompleted: number;
  reviewTarget: number;
  reviewRemaining: number;
  generatedSchemes: number;
  reviewFinished: boolean;
  reviewRestDay: boolean;
  reviewTone: ReviewTone;
  exam?: ExamCountdown;
  examError?: ResourceCommandError;
  hasActivePlan: boolean;
  hasSavedPaperDraft: boolean;
  busyTaskId?: string;
  onRefresh(): void;
  onOpenWorkbook(): void;
  onOpenPaper(): void;
  onEditExam(): void;
  onStartReview(openWindow: boolean): void;
}

export function TodaySupportSections({
  review,
  activeSchemes,
  reviewError,
  reviewCompleted,
  reviewTarget,
  reviewRemaining,
  generatedSchemes,
  reviewFinished,
  reviewRestDay,
  reviewTone,
  exam,
  examError,
  hasActivePlan,
  hasSavedPaperDraft,
  busyTaskId,
  onRefresh,
  onOpenWorkbook,
  onOpenPaper,
  onEditExam,
  onStartReview,
}: TodaySupportSectionsProps) {
  return (
    <aside className="today-support" aria-label="辅助信息">
      <section
        className={`today-support-item${reviewRemaining > 0 && !reviewRestDay && review !== undefined ? " today-review-promoted" : ""}`}
        aria-labelledby="today-review-title"
      >
        <SectionHeader
          id="today-review-title"
          level={3}
          title="错题待复习"
          description={`${formatOverviewNumber(reviewCompleted)} / ${formatOverviewNumber(reviewTarget)} 道已完成`}
          actions={
            reviewError !== undefined ? (
              <Button variant="text" size="sm" onClick={onRefresh}>
                重新读取
              </Button>
            ) : review === undefined || activeSchemes.length === 0 ? (
              <Button variant="text" size="sm" onClick={onOpenWorkbook}>
                打开习题册
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={busyTaskId !== undefined}
                onClick={() => onStartReview(!reviewRestDay && !reviewFinished)}
              >
                {busyTaskId === "today-review"
                  ? "正在准备…"
                  : reviewRestDay || reviewFinished
                    ? "查看今日错题"
                    : generatedSchemes === 0
                      ? "开始复习"
                      : "继续复习"}
              </Button>
            )
          }
        />
        {reviewError === undefined ? (
          review === undefined || activeSchemes.length === 0 ? (
            <p className="today-support-copy">
              完成练习并登记结果后，错题会进入今日复习。
            </p>
          ) : (
            <div className="today-support-copy">
              <Badge tone={reviewTone}>
                {reviewRestDay
                  ? "休息日"
                  : reviewFinished
                    ? "今日已完成"
                    : `${formatOverviewNumber(reviewRemaining)} 道待复习`}
              </Badge>
              <p>
                {reviewRestDay
                  ? "今天是休息日，错题会顺延到下一个学习日。"
                  : generatedSchemes === 0
                    ? `今天有 ${formatOverviewNumber(activeSchemes.length)} 份错题方案等待开始。`
                    : reviewFinished
                      ? "今天的错题已经完成。"
                      : `已完成 ${formatOverviewNumber(reviewCompleted)} / ${formatOverviewNumber(reviewTarget)} 道。`}
              </p>
            </div>
          )
        ) : (
          <StatusBanner tone="error" title={reviewError.message}>
            {reviewError.action}
          </StatusBanner>
        )}
      </section>

      <section
        className="today-support-item"
        aria-labelledby="today-paper-title"
      >
        <SectionHeader
          id="today-paper-title"
          level={3}
          title="智能组卷"
          description={
            hasSavedPaperDraft ? "已有一份可继续的组卷" : "按题库范围生成练习卷"
          }
          actions={
            <Button variant="secondary" size="sm" onClick={onOpenPaper}>
              {hasSavedPaperDraft ? "继续组卷" : "新建组卷"}
            </Button>
          }
        />
        <p className="today-support-copy">
          {hasSavedPaperDraft
            ? "继续上次暂存的练习卷，保留原有组卷规则和题目。"
            : "从多个科目、练习册和题型中自由组合一份练习卷。"}
        </p>
      </section>

      <section
        className="today-support-item"
        aria-labelledby="today-exam-title"
      >
        <SectionHeader
          id="today-exam-title"
          level={3}
          title={exam?.examName ?? "最近考试"}
          description="考试倒计时"
          actions={
            <Button
              variant="text"
              size="sm"
              onClick={() => {
                if (examError !== undefined) {
                  onRefresh();
                  return;
                }
                onEditExam();
              }}
            >
              {examError !== undefined
                ? "重新读取"
                : hasActivePlan
                  ? "编辑考试"
                  : "设置考试"}
            </Button>
          }
        />
        {examError === undefined ? (
          exam === undefined ? (
            <p className="today-support-copy">
              在有效计划中填写未过期的考试日期后，这里会显示倒计时。
            </p>
          ) : (
            <p className="today-support-copy">
              <strong>
                {exam.isToday
                  ? "今天考试"
                  : `还有 ${formatOverviewNumber(exam.daysRemaining)} 天`}
              </strong>
              <span>{formatOverviewDate(exam.examDate)}</span>
            </p>
          )
        ) : (
          <StatusBanner tone="error" title="考试信息暂时不可用">
            {examError.action}
          </StatusBanner>
        )}
      </section>
    </aside>
  );
}
