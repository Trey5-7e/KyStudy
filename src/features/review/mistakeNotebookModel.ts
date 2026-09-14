import type {
  BulkQuestionAttempt,
  IndexedQuestion,
} from "../../shared/tauri/questionBankClient";
import type {
  AttemptResult,
  QuestionType,
} from "../../shared/tauri/questionClient";
import type { BadgeTone } from "../../shared/ui/Badge";
import { isMistakeQuestion } from "./instantMistakeModel";
import { loadAllQuestionTags } from "./mistakeTagModel";

export type MistakeStatusFilter = "all" | "pending" | "mastered";
export type MistakeSortOption =
  "priority" | "frequency" | "natural" | "forgetting_curve";
export type MistakeFrequencyFilter = "all" | "gte2" | "gte3";

export interface MistakeNotebookFilter {
  subjectId?: string;
  workbookId?: string;
  questionType?: QuestionType | "all";
  status: MistakeStatusFilter;
  errorThreshold?: MistakeFrequencyFilter;
  tag?: string;
  query: string;
  sortBy?: MistakeSortOption;
}

export interface MistakeSummary {
  totalCount: number;
  pendingCount: number;
  masteredCount: number;
  masteryRate: number;
}

/**
 * 判断错题当前是否处于“待攻克”状态（最新状态为做错或模糊）
 */
export function isMistakePending(q: IndexedQuestion): boolean {
  return q.currentResult === "incorrect" || q.currentResult === "uncertain";
}

/**
 * 判断错题是否处于“已攻克”状态（曾有做错/模糊记录，但最新作答已正确掌握）
 */
export function isMistakeMastered(q: IndexedQuestion): boolean {
  if (!isMistakeQuestion(q)) return false;
  return q.currentResult === "correct";
}

/**
 * 汇总统计错题池全局指标
 */
export function summarizeMistakes(
  questions: readonly IndexedQuestion[],
): MistakeSummary {
  const mistakes = questions.filter(isMistakeQuestion);
  const totalCount = mistakes.length;
  let pendingCount = 0;
  let masteredCount = 0;

  for (const q of mistakes) {
    if (isMistakePending(q)) {
      pendingCount++;
    } else if (isMistakeMastered(q)) {
      masteredCount++;
    }
  }

  const masteryRate =
    totalCount > 0 ? Math.round((masteredCount / totalCount) * 100) : 0;

  return {
    totalCount,
    pendingCount,
    masteredCount,
    masteryRate,
  };
}

export type ForgettingStatus =
  | "overdue"
  | "due_today"
  | "urgent_retry"
  | "expiring"
  | "stable"
  | "unreviewed";

export interface ForgettingMeta {
  status: ForgettingStatus;
  urgencyScore: number;
  label: string;
  tone: BadgeTone;
  daysDiff?: number;
}

export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 计算两个 YYYY-MM-DD 日期的日历天数差 (dateA - dateB)
 */
export function diffCalendarDays(dateA: string, dateB: string): number {
  const partsA = dateA.split("-");
  const partsB = dateB.split("-");
  if (partsA.length !== 3 || partsB.length !== 3) {
    return 0;
  }
  const yA = Number(partsA[0]);
  const mA = Number(partsA[1]);
  const dA = Number(partsA[2]);
  const yB = Number(partsB[0]);
  const mB = Number(partsB[1]);
  const dB = Number(partsB[2]);
  if (
    !Number.isFinite(yA) ||
    !Number.isFinite(mA) ||
    !Number.isFinite(dA) ||
    !Number.isFinite(yB) ||
    !Number.isFinite(mB) ||
    !Number.isFinite(dB)
  ) {
    return 0;
  }
  const msA = Date.UTC(yA, mA - 1, dA);
  const msB = Date.UTC(yB, mB - 1, dB);
  return Math.round((msA - msB) / (1000 * 60 * 60 * 24));
}

/**
 * 基于艾宾浩斯遗忘模型计算题目当前的复习紧迫度与记忆状态
 */
export function calculateForgettingMeta(
  q: IndexedQuestion,
  todayStr: string = getLocalDateString(),
  nowMs: number = Date.now(),
): ForgettingMeta {
  const isPending = isMistakePending(q);
  const incorrectCount = q.incorrectCount ?? 0;
  const partialCount = q.partialCount ?? 0;
  const totalMistakes = incorrectCount + partialCount;

  // 1. 如果有排期复习日 dueDate
  if (q.dueDate) {
    const daysUntilDue = diffCalendarDays(q.dueDate, todayStr);

    if (daysUntilDue < 0) {
      // 超期 (dueDate < today)
      const overdueDays = Math.abs(daysUntilDue);
      const urgencyScore =
        (isPending ? 10000 : 7000) + overdueDays * 100 + totalMistakes * 10;

      return {
        status: "overdue",
        urgencyScore,
        label: `已超期 ${overdueDays} 天`,
        tone: "danger",
        daysDiff: daysUntilDue,
      };
    }

    if (daysUntilDue === 0) {
      // 今日当复 (dueDate === today)
      const urgencyScore = (isPending ? 8500 : 6000) + totalMistakes * 10;
      return {
        status: "due_today",
        urgencyScore,
        label: "今日当复",
        tone: "warning",
        daysDiff: 0,
      };
    }

    // daysUntilDue > 0: 未来待复习
    if (isPending) {
      const urgencyScore = Math.max(
        5000 - daysUntilDue * 50 + totalMistakes * 10,
        1000,
      );
      return {
        status: "expiring",
        urgencyScore,
        label: daysUntilDue === 1 ? "明日重练" : `${daysUntilDue} 天后重练`,
        tone: daysUntilDue === 1 ? "warning" : "info",
        daysDiff: daysUntilDue,
      };
    }

    // 已攻克，排在未来
    if (daysUntilDue <= 2) {
      const urgencyScore = 4000 - daysUntilDue * 500 + totalMistakes * 5;
      return {
        status: "expiring",
        urgencyScore,
        label: daysUntilDue === 1 ? "明日当复" : `${daysUntilDue} 天后复习`,
        tone: "info",
        daysDiff: daysUntilDue,
      };
    }

    // daysUntilDue > 2: 稳固记忆
    const urgencyScore = Math.max(2000 - daysUntilDue * 20, 100);
    return {
      status: "stable",
      urgencyScore,
      label: `${daysUntilDue} 天后复习`,
      tone: "success",
      daysDiff: daysUntilDue,
    };
  }

  // 2. 没有 dueDate (尚未排入间隔复习计划)
  if (isPending) {
    let elapsedHours = 0;
    if (q.lastAttemptAt) {
      elapsedHours = Math.max(0, (nowMs - q.lastAttemptAt) / (1000 * 60 * 60));
    }
    const elapsedDays = Math.floor(elapsedHours / 24);

    if (elapsedDays >= 1) {
      const urgencyScore =
        8000 + Math.min(elapsedDays, 30) * 50 + totalMistakes * 10;
      return {
        status: "urgent_retry",
        urgencyScore,
        label: "亟待攻克",
        tone: "danger",
      };
    }

    const urgencyScore = 7500 + totalMistakes * 10;
    return {
      status: "urgent_retry",
      urgencyScore,
      label: "待攻克",
      tone: "warning",
    };
  }

  // 已攻克但无 dueDate
  return {
    status: "stable",
    urgencyScore: 500 + totalMistakes * 5,
    label: "已掌握",
    tone: "neutral",
  };
}

/**
 * 多维筛选与搜索错题本清单
 */
export function filterMistakeNotebook(
  questions: readonly IndexedQuestion[],
  filter: MistakeNotebookFilter,
  tagsMap?: Record<string, string[]>,
  todayStr?: string,
  nowMs?: number,
): IndexedQuestion[] {
  const normalizedQuery = filter.query.trim().toLowerCase();

  const filtered = questions.filter((q) => {
    // 必须属于错题池
    if (!isMistakeQuestion(q)) return false;

    // 科目过滤
    if (filter.subjectId && q.subjectId !== filter.subjectId) {
      return false;
    }

    // 习题册过滤
    if (filter.workbookId && q.workbookId !== filter.workbookId) {
      return false;
    }

    // 题型过滤
    if (
      filter.questionType &&
      filter.questionType !== "all" &&
      q.questionType !== filter.questionType
    ) {
      return false;
    }

    // 掌握状态过滤
    if (filter.status === "pending" && !isMistakePending(q)) {
      return false;
    }
    if (filter.status === "mastered" && !isMistakeMastered(q)) {
      return false;
    }

    // 错误频次过滤 (反复失分 / 顽固重灾区)
    if (filter.errorThreshold === "gte2") {
      if (q.incorrectCount + q.partialCount < 2) return false;
    } else if (filter.errorThreshold === "gte3") {
      if (q.incorrectCount + q.partialCount < 3) return false;
    }

    // 标签过滤
    if (filter.tag && filter.tag !== "all") {
      const qTags =
        tagsMap?.[q.id] ??
        (typeof window !== "undefined"
          ? (loadAllQuestionTags()[q.id] ?? [])
          : []);
      if (!qTags.includes(filter.tag)) {
        return false;
      }
    }

    // 关键词搜索（题目标题、题号、章节、习题册名）
    if (normalizedQuery.length > 0) {
      const matchTitle = q.title.toLowerCase().includes(normalizedQuery);
      const matchNumber = String(q.questionNumber).includes(normalizedQuery);
      const matchChapter = q.chapter.toLowerCase().includes(normalizedQuery);
      const matchDoc = q.documentTitle.toLowerCase().includes(normalizedQuery);

      if (!matchTitle && !matchNumber && !matchChapter && !matchDoc) {
        return false;
      }
    }

    return true;
  });

  const sortBy = filter.sortBy ?? "priority";
  const effectiveToday = todayStr ?? getLocalDateString();
  const effectiveNow = nowMs ?? Date.now();

  return filtered.sort((a, b) => {
    if (sortBy === "forgetting_curve") {
      const metaA = calculateForgettingMeta(a, effectiveToday, effectiveNow);
      const metaB = calculateForgettingMeta(b, effectiveToday, effectiveNow);
      if (metaA.urgencyScore !== metaB.urgencyScore) {
        return metaB.urgencyScore - metaA.urgencyScore;
      }
      if (a.incorrectCount !== b.incorrectCount) {
        return b.incorrectCount - a.incorrectCount;
      }
      return (
        a.sortOrder - b.sortOrder ||
        a.questionNumber.localeCompare(b.questionNumber, undefined, {
          numeric: true,
        })
      );
    }

    if (sortBy === "natural") {
      return (
        a.sortOrder - b.sortOrder ||
        a.questionNumber.localeCompare(b.questionNumber, undefined, {
          numeric: true,
        })
      );
    }

    if (sortBy === "frequency") {
      if (a.incorrectCount !== b.incorrectCount) {
        return b.incorrectCount - a.incorrectCount;
      }
      if (a.partialCount !== b.partialCount) {
        return b.partialCount - a.partialCount;
      }
      return (
        a.sortOrder - b.sortOrder ||
        a.questionNumber.localeCompare(b.questionNumber, undefined, {
          numeric: true,
        })
      );
    }

    // sortBy === "priority" (默认)
    // 待攻克优先于已攻克，做错优先于模糊，错误次数多者靠前
    const aPending = isMistakePending(a);
    const bPending = isMistakePending(b);
    if (aPending !== bPending) return aPending ? -1 : 1;

    // 均待攻克时，当前做错优于模糊
    if (aPending && bPending) {
      if (a.currentResult !== b.currentResult) {
        return a.currentResult === "incorrect" ? -1 : 1;
      }
    }

    // 按历史做错频次降序
    if (a.incorrectCount !== b.incorrectCount) {
      return b.incorrectCount - a.incorrectCount;
    }

    return (
      a.sortOrder - b.sortOrder ||
      a.questionNumber.localeCompare(b.questionNumber, undefined, {
        numeric: true,
      })
    );
  });
}

/**
 * 构造批量打标尝试记录请求对象
 */
export function createBatchAttempts(
  questionIds: Iterable<string>,
  result: AttemptResult,
): BulkQuestionAttempt[] {
  return Array.from(questionIds).map((id) => ({
    questionId: id,
    result,
  }));
}
