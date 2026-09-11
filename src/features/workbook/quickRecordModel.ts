import type { AttemptResult } from "../../shared/tauri/questionClient";
import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import { parseQuestionNumberSelection } from "./questionBankModel";

export type MatrixMode = AttemptResult;
export type MatrixAction = MatrixMode | "clear";

export interface QuickRecordFields {
  completed: string;
  incorrect: string;
  partial: string;
}

export const MATRIX_MODE_OPTIONS: ReadonlyArray<{
  value: MatrixMode;
  label: string;
}> = [
  { value: "correct", label: "做对" },
  { value: "incorrect", label: "做错" },
  { value: "uncertain", label: "不全对" },
];

export function parseMatrixNumbers(value: string): Set<string> {
  try {
    return new Set(parseQuestionNumberSelection(value));
  } catch {
    return new Set();
  }
}

export function formatMatrixNumbers(numbers: Set<string>): string {
  return [...numbers]
    .sort((left, right) => Number(left) - Number(right))
    .join(",");
}

export function updateMatrixFields(
  fields: QuickRecordFields,
  questionNumber: string,
  action: MatrixAction,
): QuickRecordFields {
  const next = {
    completed: parseMatrixNumbers(fields.completed),
    incorrect: parseMatrixNumbers(fields.incorrect),
    partial: parseMatrixNumbers(fields.partial),
  };
  next.completed.delete(questionNumber);
  next.incorrect.delete(questionNumber);
  next.partial.delete(questionNumber);
  if (action !== "clear") {
    const target =
      action === "correct"
        ? next.completed
        : action === "incorrect"
          ? next.incorrect
          : next.partial;
    target.add(questionNumber);
  }
  return {
    completed: formatMatrixNumbers(next.completed),
    incorrect: formatMatrixNumbers(next.incorrect),
    partial: formatMatrixNumbers(next.partial),
  };
}

export function matrixStatusByNumber(
  fields: QuickRecordFields,
): ReadonlyMap<string, AttemptResult> {
  const next = new Map<string, AttemptResult>();
  for (const number of parseMatrixNumbers(fields.completed))
    next.set(number, "correct");
  for (const number of parseMatrixNumbers(fields.partial))
    next.set(number, "uncertain");
  for (const number of parseMatrixNumbers(fields.incorrect))
    next.set(number, "incorrect");
  return next;
}

export interface MatrixCellState {
  effectiveStatus?: AttemptResult;
  isStaged: boolean;
  hasSavedStatus: boolean;
  label: string;
}

export function matrixCellStatus(
  question: IndexedQuestion,
  stagedStatus?: AttemptResult,
): MatrixCellState {
  const savedStatus = question.currentResult;
  const effectiveStatus = stagedStatus ?? savedStatus;
  const isStaged = stagedStatus !== undefined;
  const hasSavedStatus = savedStatus !== undefined;

  const statusText =
    effectiveStatus === "correct"
      ? "做对"
      : effectiveStatus === "incorrect"
        ? "做错"
        : effectiveStatus === "uncertain"
          ? "不全对"
          : "未做";

  const label = isStaged
    ? `${question.questionNumber}题本次标记：${statusText}`
    : hasSavedStatus
      ? `${question.questionNumber}题已保存状态：${statusText}`
      : `${question.questionNumber}题未做`;

  return {
    effectiveStatus,
    isStaged,
    hasSavedStatus,
    label,
  };
}

export function compareMatrixQuestions(
  left: IndexedQuestion,
  right: IndexedQuestion,
): number {
  const leftNumber = Number(left.questionNumber.trim());
  const rightNumber = Number(right.questionNumber.trim());
  const leftNumeric = Number.isSafeInteger(leftNumber);
  const rightNumeric = Number.isSafeInteger(rightNumber);
  if (leftNumeric && rightNumeric && leftNumber !== rightNumber)
    return leftNumber - rightNumber;
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left.questionNumber.localeCompare(right.questionNumber, "zh-CN");
}
