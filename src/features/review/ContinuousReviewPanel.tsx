import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { EditorDialog } from "../../shared/components/EditorDialog";
import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
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
        <Badge tone={session.totalCount === 0 ? "neutral" : "success"}>
          {session.totalCount === 0 ? "暂无到期题" : "今日完成"}
        </Badge>
        <h3 aria-label="review progress">
          {session.totalCount === 0 ? "今天没有到期题" : "今天的错题已完成"}
        </h3>
        <p>{session.completedCount} 道反馈已经保存。</p>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !session.latestCompletedQueueId}
            onClick={() =>
              session.latestCompletedQueueId &&
              void onUndo(session.latestCompletedQueueId)
            }
          >
            撤销上一题
          </Button>
          <Button variant="text" size="sm" onClick={onManage}>
            查看方案
          </Button>
        </div>
      </section>
    );
  return (
    <>
      <section className="continuous-review-complete">
        <p>今日连续复习</p>
        <h3>
          {session.completedCount} / {session.totalCount}
        </h3>
        <Button
          ref={prepareRef}
          variant="primary"
          size="md"
          disabled={busy}
          onClick={() => void onPrepare()}
        >
          准备今日队列
        </Button>
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
            key={active.question.question.id}
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
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  const key = (e: KeyboardEvent<HTMLElement>) => {
    if (busy || e.repeat) return;

    if (e.key === " " || e.key === "Spacebar" || e.key === "Enter") {
      if (!revealed) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
    }

    if ((e.key === "z" || e.key === "Z") && canUndo) {
      e.preventDefault();
      void onUndo(queueId);
      return;
    }

    const rating = reviewRatingForShortcut(e.key);
    if (rating) {
      e.preventDefault();
      if (!revealed) {
        setRevealed(true);
      }
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

      {!revealed ? (
        <div className="review-reveal-container">
          <button
            type="button"
            className="review-reveal-button"
            onClick={() => setRevealed(true)}
          >
            <span>显示解析与答案</span>
            <kbd>Space</kbd>
          </button>
          <span className="review-hint-copy">
            先自行思考作答，点击或按空格键揭晓答案
          </span>
        </div>
      ) : (
        <div className="review-answer-revealed">
          <QuestionAiAnalysis
            key={`${q.id}-${q.updatedAt}`}
            question={q}
            regions={item.question.regions}
          />
          <div className="review-feedback-buttons">
            <button
              type="button"
              className="feedback-mastered"
              disabled={busy}
              onClick={() => void onFeedback(queueId, q.id, "mastered")}
            >
              掌握 <kbd>1</kbd>
            </button>
            <button
              type="button"
              className="feedback-uncertain"
              disabled={busy}
              onClick={() => void onFeedback(queueId, q.id, "uncertain")}
            >
              模糊 <kbd>2</kbd>
            </button>
            <button
              type="button"
              className="feedback-failed"
              disabled={busy}
              onClick={() => void onFeedback(queueId, q.id, "failed")}
            >
              不会 <kbd>3</kbd>
            </button>
          </div>
        </div>
      )}

      <div className="review-footer-bar">
        <Button
          type="button"
          variant="text"
          size="sm"
          disabled={busy || !canUndo}
          onClick={() => void onUndo(queueId)}
        >
          撤销上一题 <kbd>Z</kbd>
        </Button>
        {revealed && (
          <span className="review-hint-copy">
            按 1/2/3 评价掌握度，自动进入下一题
          </span>
        )}
      </div>
    </section>
  );
}
