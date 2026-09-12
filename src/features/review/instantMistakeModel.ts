import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import type {
  ReviewSchemeQueueItem,
  ReviewSchemeRating,
} from "../../shared/tauri/reviewSchemeClient";

export interface InstantMistakeSelectOptions {
  count: number;
  subjectId?: string;
  workbookId?: string;
  avoidQuestionIds?: ReadonlySet<string>;
}

/**
 * 判断题目是否属于错题池范围：
 * 1. 当前答题状态为“错误”或“模糊”
 * 2. 或者历史上曾有“错误”或“模糊”记录
 */
export function isMistakeQuestion(question: IndexedQuestion): boolean {
  if (
    question.currentResult === "incorrect" ||
    question.currentResult === "uncertain"
  ) {
    return true;
  }
  return question.incorrectCount > 0 || question.partialCount > 0;
}

/**
 * 筛选符合科目与练习册要求的错题池
 */
export function filterMistakePool(
  questions: readonly IndexedQuestion[],
  subjectId?: string,
  workbookId?: string,
): IndexedQuestion[] {
  return questions.filter((q) => {
    if (!isMistakeQuestion(q)) return false;
    if (subjectId && q.subjectId !== subjectId) return false;
    if (workbookId && q.workbookId !== workbookId) return false;
    return true;
  });
}

/**
 * 错题推送算法评分函数：
 * 分数越高，题目在本次推送中的优先级越高。
 *
 * 核心权重因子：
 * 1. 当前状态：当前未攻克做错（+100） > 当前模糊（+60） > 历史错题本次做对（+15） > 未答（+10）
 * 2. 顽固频次：历史做错次数 * 35 + 历史模糊次数 * 20
 * 3. 错误率加权：若有作答历史，错误占比越高额外增加至多 40 分
 */
export function scoreMistakeQuestion(question: IndexedQuestion): number {
  let score = 0;

  switch (question.currentResult) {
    case "incorrect":
      score += 100;
      break;
    case "uncertain":
      score += 60;
      break;
    case "correct":
      score += 15;
      break;
    default:
      score += 10;
      break;
  }

  score += question.incorrectCount * 35;
  score += question.partialCount * 20;

  if (question.attemptCount > 0) {
    const errorRatio = question.incorrectCount / question.attemptCount;
    score += Math.round(errorRatio * 40);
  }

  return score;
}

/**
 * 按照错题算法直接推送指定数量的高优先级错题。
 * 支持 avoidQuestionIds（例如在“再来一组”时优先排除上一组已刷题目，池子不足时再兜底回填）。
 */
export function selectInstantMistakeQuestions(
  questions: readonly IndexedQuestion[],
  options: InstantMistakeSelectOptions,
): IndexedQuestion[] {
  const targetCount = Math.max(1, options.count);
  const pool = filterMistakePool(
    questions,
    options.subjectId,
    options.workbookId,
  );
  if (pool.length === 0) return [];

  const avoid = options.avoidQuestionIds ?? new Set<string>();

  const freshCandidates: IndexedQuestion[] = [];
  const avoidedCandidates: IndexedQuestion[] = [];

  for (const q of pool) {
    if (avoid.has(q.id)) {
      avoidedCandidates.push(q);
    } else {
      freshCandidates.push(q);
    }
  }

  const scoreComparator = (a: IndexedQuestion, b: IndexedQuestion) => {
    const scoreDiff = scoreMistakeQuestion(b) - scoreMistakeQuestion(a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.sortOrder - b.sortOrder;
  };

  freshCandidates.sort(scoreComparator);
  avoidedCandidates.sort(scoreComparator);

  const selected: IndexedQuestion[] = [];

  for (const q of freshCandidates) {
    if (selected.length >= targetCount) break;
    selected.push(q);
  }

  if (selected.length < targetCount) {
    for (const q of avoidedCandidates) {
      if (selected.length >= targetCount) break;
      selected.push(q);
    }
  }

  return selected;
}

/**
 * 将 IndexedQuestion 转换为 ReviewSchemeQueueItem 格式，
 * 便于直接复用验证完善的 QuestionReviewContent 交互卡片与快捷键。
 */
export function indexedQuestionToReviewItem(
  q: IndexedQuestion,
  position: number,
  rating?: ReviewSchemeRating,
): ReviewSchemeQueueItem {
  return {
    question: {
      question: {
        id: q.id,
        documentId: q.documentId,
        documentTitle: q.documentTitle,
        subjectId: q.subjectId,
        subjectInherited: false,
        chapter: q.chapter,
        questionNumber: q.questionNumber,
        questionType: q.questionType,
        difficulty: 0,
        title: q.title,
        classificationSource: "manual",
        classificationConfidence: q.indexConfidence,
        createdAt: 0,
        updatedAt: 0,
      },
      regions: q.regions,
      attempts: [],
      knowledgeLinks: [],
    },
    position,
    originDate: "",
    carried: false,
    state: rating ? "completed" : "pending",
    insertedAt: Date.now(),
    rating,
  };
}
