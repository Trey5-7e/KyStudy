import type {
  IndexedQuestion,
  QuestionBankSnapshot,
} from "../../shared/tauri/questionBankClient";
import type { RelativeQuestionInsert } from "./QuestionIndexDialogs";

export function manualIndexDialogInitialSegmentId(
  snapshot: QuestionBankSnapshot,
  requestedSegmentId?: string,
  existingQuestion?: Pick<IndexedQuestion, "segmentId">,
  relativeInsert?: Pick<RelativeQuestionInsert, "anchorQuestion">,
): string {
  return (
    existingQuestion?.segmentId ??
    relativeInsert?.anchorQuestion.segmentId ??
    requestedSegmentId ??
    snapshot.segments[0]?.id ??
    ""
  );
}

/**
 * Increment question number naturally for continuous manual indexing.
 * E.g.:
 * - "1" -> "2"
 * - "15" -> "16"
 * - "01" -> "02"
 * - "1.1" -> "1.2"
 * - "Q1" -> "Q2"
 * - "第3题" -> "第4题"
 */
export function nextSuggestedQuestionNumber(current: string): string {
  const trimmed = current.trim();
  if (trimmed === "") return "";
  const match = trimmed.match(/^(.*?)(\d+)(\D*)$/);
  if (!match || !match[2]) return trimmed;
  const prefix = match[1] ?? "";
  const numStr = match[2];
  const suffix = match[3] ?? "";
  const nextNum = parseInt(numStr, 10) + 1;
  const padded =
    numStr.startsWith("0") && numStr.length > 1
      ? String(nextNum).padStart(numStr.length, "0")
      : String(nextNum);
  return `${prefix}${padded}${suffix}`;
}

export function nextSuggestedQuestionTitle(
  nextNumber: string,
  previousTitle?: string,
): string {
  if (nextNumber.trim() === "") return previousTitle ?? "";
  return `第 ${nextNumber} 题`;
}
