import { useEffect, useRef, type KeyboardEvent } from "react";
import { EditorDialog } from "../../shared/components/EditorDialog";
import type {
  ReviewSchemeQueueItem,
  ReviewSchemeRating,
} from "../../shared/tauri/reviewSchemeClient";
import type { ContinuousReviewSession } from "./continuousReview";
import { QuestionRegionCard } from "./QuestionRegionCard";
import { QuestionAiAnalysis } from "./QuestionAiAnalysis";
import { reviewRatingForShortcut } from "./reviewFeedback";

export function ContinuousReviewPanel({
  session,
  openRequest,
  onClose,
  busy,
  onPrepare,
  onFeedback,
  onUndo,
  onManage,
}: {
  session: ContinuousReviewSession;
  openRequest?: number;
  onClose(): void;
  busy: boolean;
  onPrepare(): Promise<boolean>;
  onFeedback(
    queueId: string,
    questionId: string,
    rating: ReviewSchemeRating,
  ): Promise<boolean>;
  onUndo(queueId: string): Promise<boolean>;
  onManage(): void;
}) {
  const active = session.activeItem;
  const shouldOpen = openRequest !== undefined && !!active;
  const prepareRef = useRef<HTMLButtonElement>(null);
  if (!active || !session.activeScheme)
    return (
      <section className="continuous-review-complete" aria-live="polite">
        <h3 aria-label="review progress">
          {session.totalCount === 0 ? "今天没有到期题" : "今天的错题已完成"}
        </h3>
        <p>{session.completedCount} 道反馈已经保存。</p>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !session.latestCompletedQueueId}
          onClick={() =>
            session.latestCompletedQueueId &&
            void onUndo(session.latestCompletedQueueId)
          }
        >
          撤销上一题
        </button>
        <button type="button" className="text-button" onClick={onManage}>
          查看方案
        </button>
      </section>
    );
  return (
    <>
      <section className="continuous-review-complete">
        <p>今日连续复习</p>
        <h3>
          {session.completedCount} / {session.totalCount}
        </h3>
        <button
          ref={prepareRef}
          type="button"
          disabled={busy}
          onClick={() => void onPrepare()}
        >
          准备今日队列
        </button>
      </section>
      {shouldOpen && (
        <EditorDialog
          title="今日连续复习"
          description={`${session.completedCount}/${session.totalCount}`}
          dirty={false}
          onRequestClose={onClose}
          returnFocusRef={prepareRef}
          size="review"
        >
          <QuestionReviewContent
            item={active}
            queueId={session.activeScheme.queue?.id ?? ""}
            busy={busy}
            canUndo={!!session.latestCompletedQueueId}
            onFeedback={onFeedback}
            onUndo={onUndo}
          />
        </EditorDialog>
      )}
    </>
  );
}
export function QuestionReviewContent({
  item,
  queueId,
  busy,
  canUndo,
  onFeedback,
  onUndo,
}: {
  item: ReviewSchemeQueueItem;
  queueId: string;
  busy: boolean;
  canUndo: boolean;
  onFeedback(
    queueId: string,
    questionId: string,
    rating: ReviewSchemeRating,
  ): Promise<boolean>;
  onUndo(queueId: string): Promise<boolean>;
}) {
  const ref = useRef<HTMLElement>(null);
  const q = item.question.question;
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [q.id]);
  const key = (e: KeyboardEvent<HTMLElement>) => {
    if (busy || e.repeat) return;
    const rating = reviewRatingForShortcut(e.key);
    if (rating) {
      e.preventDefault();
      void onFeedback(queueId, q.id, rating);
    }
  };
  return (
    <section
      ref={ref}
      tabIndex={0}
      className="review-question-simple-card review-question-focus"
      aria-label="current review question"
      onKeyDown={key}
    >
      <QuestionRegionCard
        documentId={q.documentId}
        title={q.title}
        regions={item.question.regions}
      />
      <h4>{q.title}</h4>
      <QuestionAiAnalysis
        key={`${q.id}-${q.updatedAt}`}
        question={q}
        regions={item.question.regions}
      />
      <div className="review-feedback-buttons">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onFeedback(queueId, q.id, "mastered")}
        >
          掌握 <kbd>1</kbd>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onFeedback(queueId, q.id, "uncertain")}
        >
          模糊 <kbd>2</kbd>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onFeedback(queueId, q.id, "failed")}
        >
          不会 <kbd>3</kbd>
        </button>
      </div>
      <button
        type="button"
        className="text-button"
        disabled={busy || !canUndo}
        onClick={() => void onUndo(queueId)}
      >
        撤销上一题
      </button>
    </section>
  );
}
