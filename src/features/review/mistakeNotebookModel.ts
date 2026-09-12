import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import type { QuestionType } from "../../shared/tauri/questionClient";
import { isMistakeQuestion } from "./instantMistakeModel";

export type MistakeStatusFilter = "all" | "pending" | "mastered";
export type MistakeSortOption = "priority" | "frequency" | "natural";

export interface MistakeNotebookFilter {
  subjectId?: string;
  workbookId?: string;
  questionType?: QuestionType | "all";
  status: MistakeStatusFilter;
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

/**
 * 多维筛选与搜索错题本清单
 */
export function filterMistakeNotebook(
  questions: readonly IndexedQuestion[],
  filter: MistakeNotebookFilter,
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

  return filtered.sort((a, b) => {
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
