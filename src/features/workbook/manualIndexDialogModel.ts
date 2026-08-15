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
