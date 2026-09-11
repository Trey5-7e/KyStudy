import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import type {
  AttemptResult,
  QuestionType,
} from "../../shared/tauri/questionClient";

export type PaperViewMode = "continuous" | "single";
export type PaperQuestionFilter = "all" | QuestionType;

export interface PaperViewState {
  mode: PaperViewMode;
  selectedQuestionType: PaperQuestionFilter;
  activeQuestionId?: string;
}

export interface PaperQuestionPosition {
  filteredIndex: number;
  filteredTotal: number;
  paperIndex: number;
  paperTotal: number;
}

export const DEFAULT_PAPER_VIEW_STATE: PaperViewState = {
  mode: "continuous",
  selectedQuestionType: "all",
};

export function filterPaperQuestions(
  questions: readonly IndexedQuestion[],
  filter: PaperQuestionFilter,
): IndexedQuestion[] {
  return filter === "all"
    ? [...questions]
    : questions.filter((question) => question.questionType === filter);
}

export function selectPaperQuestionId(
  questions: readonly IndexedQuestion[],
  activeQuestionId: string | undefined,
  results: Readonly<Record<string, AttemptResult>> = {},
): string | undefined {
  if (questions.length === 0) return undefined;
  if (
    activeQuestionId !== undefined &&
    questions.some((question) => question.id === activeQuestionId)
  ) {
    return activeQuestionId;
  }
  return (
    questions.find((question) => results[question.id] === undefined)?.id ??
    questions[0]?.id
  );
}

export function firstUnansweredPaperQuestionId(
  questions: readonly IndexedQuestion[],
  results: Readonly<Record<string, AttemptResult>> = {},
): string | undefined {
  return questions.find((question) => results[question.id] === undefined)?.id;
}

export function navigatePaperQuestion(
  questions: readonly IndexedQuestion[],
  activeQuestionId: string | undefined,
  direction: "previous" | "next",
): string | undefined {
  const activeIndex = questions.findIndex(
    (question) => question.id === activeQuestionId,
  );
  if (activeIndex < 0) return selectPaperQuestionId(questions, undefined);
  const nextIndex = direction === "next" ? activeIndex + 1 : activeIndex - 1;
  return questions[nextIndex]?.id;
}

export function paperQuestionPosition(
  paperQuestions: readonly IndexedQuestion[],
  visibleQuestions: readonly IndexedQuestion[],
  activeQuestionId: string | undefined,
): PaperQuestionPosition | undefined {
  const filteredIndex = visibleQuestions.findIndex(
    (question) => question.id === activeQuestionId,
  );
  const paperIndex = paperQuestions.findIndex(
    (question) => question.id === activeQuestionId,
  );
  if (filteredIndex < 0 || paperIndex < 0) return undefined;
  return {
    filteredIndex,
    filteredTotal: visibleQuestions.length,
    paperIndex,
    paperTotal: paperQuestions.length,
  };
}

export interface PaperSubmissionSummary {
  totalCount: number;
  attemptedCount: number;
  correctCount: number;
  uncertainCount: number;
  incorrectCount: number;
  accuracyPercent: number;
  incorrectQuestions: IndexedQuestion[];
}

export function calculatePaperSubmissionSummary(
  questions: readonly IndexedQuestion[],
  results: Readonly<Record<string, AttemptResult>>,
): PaperSubmissionSummary {
  let correctCount = 0;
  let uncertainCount = 0;
  let incorrectCount = 0;
  const incorrectQuestions: IndexedQuestion[] = [];

  for (const question of questions) {
    const result = results[question.id];
    if (result === "correct") {
      correctCount += 1;
    } else if (result === "uncertain") {
      uncertainCount += 1;
      incorrectQuestions.push(question);
    } else if (result === "incorrect") {
      incorrectCount += 1;
      incorrectQuestions.push(question);
    }
  }

  const attemptedCount = correctCount + uncertainCount + incorrectCount;
  const accuracyPercent =
    attemptedCount === 0
      ? 0
      : Math.round((correctCount / attemptedCount) * 100);

  return {
    totalCount: questions.length,
    attemptedCount,
    correctCount,
    uncertainCount,
    incorrectCount,
    accuracyPercent,
    incorrectQuestions,
  };
}

export function isPaperNavigationTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined") return false;
  if (!(target instanceof Element)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return true;
  }
  if (
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  ) {
    return true;
  }
  if (
    target.closest(
      ".paper-ai-analysis-dialog, .manual-index-dialog, .editor-dialog:not(.generated-paper-dialog)",
    ) !== null
  ) {
    return true;
  }
  return false;
}

export function shouldHandlePaperNavigationKey(
  event: Pick<
    KeyboardEvent,
    "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "target"
  >,
): boolean {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return false;
  return !isPaperNavigationTarget(event.target);
}

export function paperResultFromKey(
  event: Pick<
    KeyboardEvent,
    "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "target"
  >,
): AttemptResult | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return undefined;
  if (isPaperNavigationTarget(event.target)) return undefined;
  if (event.key === "1") return "correct";
  if (event.key === "2") return "uncertain";
  if (event.key === "3") return "incorrect";
  return undefined;
}
