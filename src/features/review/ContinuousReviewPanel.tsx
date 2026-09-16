import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { EditorDialog } from "../../shared/components/EditorDialog";
import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import type {
  ReviewSchemeQueueItem,
  ReviewSchemeRating,
} from "../../shared/tauri/reviewSchemeClient";
import {
  calculateReviewSessionSummary,
  type ContinuousReviewSession,
} from "./continuousReview";
import { QuestionRegionCard, questionRegionsKey } from "./QuestionRegionCard";
import { QuestionAiAnalysis } from "./QuestionAiAnalysis";
import { reviewRatingForShortcut } from "./reviewFeedback";
import {
  getQuestionBank,
  type IndexedQuestion,
  type QuestionBankSnapshot,
} from "../../shared/tauri/questionBankClient";
import type {
  QuestionBundle,
  QuestionRegion,
} from "../../shared/tauri/questionClient";
import { ManualIndexDialog } from "../workbook/ManualIndexDialog";

export function ContinuousReviewPanel({
  session,
  openRequest,
  onClose,
  busy,
  questionBankSnapshot,
  onSnapshotUpdated,
  onPrepare,
  onFeedback,
  onUndo,
  onManage,
  onStartReview,
  onOpenInstantMistake,
  onOpenMistakeNotebook,
}: {
  session: ContinuousReviewSession;
  openRequest?: number;
  onClose(): void;
  busy: boolean;
  questionBankSnapshot?: QuestionBankSnapshot;
  onSnapshotUpdated?(snapshot: QuestionBankSnapshot): void;
  onPrepare(): Promise<boolean>;
  onFeedback(
    queueId: string,
    questionId: string,
    rating: ReviewSchemeRating,
  ): Promise<boolean>;
  onUndo(queueId: string): Promise<boolean>;
  onManage(): void;
  onStartReview?(): void;
  onOpenInstantMistake?(): void;
  onOpenMistakeNotebook?(): void;
}) {
  const active = session.activeItem;
  const [retryQueue, setRetryQueue] = useState<ReviewSchemeQueueItem[]>();
  const [retryIndex, setRetryIndex] = useState(0);
  const [localRatingOverrides, setLocalRatingOverrides] = useState<
    Record<string, ReviewSchemeRating>
  >({});
  const [aiAnalysisQuestion, setAiAnalysisQuestion] =
    useState<ReviewSchemeQueueItem>();
  const [bannerNotice, setBannerNotice] = useState<string>();
  const [editingRegionQuestion, setEditingRegionQuestion] =
    useState<IndexedQuestion>();
  const [localSnapshot, setLocalSnapshot] = useState<QuestionBankSnapshot>();
  const activeSnapshot = localSnapshot ?? questionBankSnapshot;
  const [regionOverrides, setRegionOverrides] = useState<
    Record<string, QuestionRegion[]>
  >({});

  const openRegionEditor = async (q: QuestionBundle | IndexedQuestion) => {
    let snap = activeSnapshot;
    if (!snap) {
      try {
        snap = await getQuestionBank();
        setLocalSnapshot(snap);
      } catch {
        // ignore
      }
    }
    const targetId = "question" in q ? q.question.id : q.id;
    let indexedQ = snap?.questions.find((item) => item.id === targetId);
    if (!indexedQ) {
      if ("question" in q) {
        indexedQ = {
          id: q.question.id,
          documentId: q.question.documentId,
          documentTitle: q.question.documentTitle,
          subjectId: q.question.subjectId ?? "",
          subjectName: q.question.subjectName ?? "",
          workbookId: "",
          workbookName: "",
          segmentId: "",
          chapter: q.question.chapter ?? "",
          sectionPart: "basic",
          questionType: q.question.questionType ?? "choice",
          questionNumber: q.question.questionNumber ?? "",
          title: q.question.title,
          indexConfidence: 1,
          sortOrder: 0,
          attemptCount: 0,
          incorrectCount: 0,
          partialCount: 0,
          regions: regionOverrides[targetId] ?? q.regions,
        };
      } else {
        indexedQ = {
          ...q,
          regions: regionOverrides[targetId] ?? q.regions,
        };
      }
    } else {
      if (regionOverrides[targetId]) {
        indexedQ = {
          ...indexedQ,
          regions: regionOverrides[targetId],
        };
      }
    }
    setEditingRegionQuestion(indexedQ);
  };

  const handleRegionSaved = (nextSnapshot: QuestionBankSnapshot) => {
    setLocalSnapshot(nextSnapshot);
    if (editingRegionQuestion) {
      const updated = nextSnapshot.questions.find(
        (item) => item.id === editingRegionQuestion.id,
      );
      if (updated) {
        setRegionOverrides((prev) => ({
          ...prev,
          [updated.id]: updated.regions,
        }));
      }
    }
    onSnapshotUpdated?.(nextSnapshot);
    setEditingRegionQuestion(undefined);
  };

  const prepareRef = useRef<HTMLButtonElement>(null);

  const summary = useMemo(() => {
    const baseSummary = calculateReviewSessionSummary(session.queuedSchemes);
    if (Object.keys(localRatingOverrides).length === 0) {
      return baseSummary;
    }
    const updatedCompleted = baseSummary.completedItems.map((item) => {
      const override = localRatingOverrides[item.question.question.id];
      return override ? { ...item, rating: override } : item;
    });
    let masteredCount = 0;
    let uncertainCount = 0;
    let failedCount = 0;
    const uncertainOrFailedItems: ReviewSchemeQueueItem[] = [];

    for (const item of updatedCompleted) {
      if (item.rating === "mastered") {
        masteredCount += 1;
      } else if (item.rating === "uncertain") {
        uncertainCount += 1;
        uncertainOrFailedItems.push(item);
      } else if (item.rating === "failed") {
        failedCount += 1;
        uncertainOrFailedItems.push(item);
      }
    }
    const completedCount = updatedCompleted.length;
    const masteryPercent =
      completedCount === 0
        ? 0
        : Math.round((masteredCount / completedCount) * 100);

    return {
      totalCount: completedCount,
      completedCount,
      masteredCount,
      uncertainCount,
      failedCount,
      masteryPercent,
      completedItems: updatedCompleted,
      uncertainOrFailedItems,
    };
  }, [session.queuedSchemes, localRatingOverrides]);

  const inRetry = retryQueue !== undefined && retryIndex < retryQueue.length;
  const activeRetryItem = inRetry ? retryQueue[retryIndex] : undefined;

  const effectiveActive = useMemo(() => {
    if (!active) return undefined;
    const qid = active.question.question.id;
    if (regionOverrides[qid]) {
      return {
        ...active,
        question: {
          ...active.question,
          regions: regionOverrides[qid],
        },
      };
    }
    return active;
  }, [active, regionOverrides]);

  const effectiveActiveRetryItem = useMemo(() => {
    if (!activeRetryItem) return undefined;
    const qid = activeRetryItem.question.question.id;
    if (regionOverrides[qid]) {
      return {
        ...activeRetryItem,
        question: {
          ...activeRetryItem.question,
          regions: regionOverrides[qid],
        },
      };
    }
    return activeRetryItem;
  }, [activeRetryItem, regionOverrides]);

  const effectiveAiAnalysisQuestion = useMemo(() => {
    if (!aiAnalysisQuestion) return undefined;
    const qid = aiAnalysisQuestion.question.question.id;
    if (regionOverrides[qid]) {
      return {
        ...aiAnalysisQuestion,
        question: {
          ...aiAnalysisQuestion.question,
          regions: regionOverrides[qid],
        },
      };
    }
    return aiAnalysisQuestion;
  }, [aiAnalysisQuestion, regionOverrides]);

  const shouldOpen =
    openRequest !== undefined &&
    (!!active || inRetry || session.totalCount > 0);

  const handleRetryFeedback = async (
    _queueId: string,
    questionId: string,
    rating: ReviewSchemeRating,
  ) => {
    if (!activeRetryItem) return true;
    if (rating === "mastered") {
      setLocalRatingOverrides((prev) => ({
        ...prev,
        [questionId]: "mastered",
      }));
    } else {
      setLocalRatingOverrides((prev) => ({
        ...prev,
        [questionId]: rating,
      }));
    }
    if (retryIndex + 1 >= (retryQueue?.length ?? 0)) {
      setRetryQueue(undefined);
      setBannerNotice("本次待巩固题目重练完成！掌握状态已即时更新。");
    } else {
      setRetryIndex((idx) => idx + 1);
    }
    return true;
  };

  const handleRetryUndo = async () => {
    if (retryIndex > 0) {
      setRetryIndex((idx) => idx - 1);
    }
    return true;
  };

  const startRetry = () => {
    if (summary.uncertainOrFailedItems.length === 0) return;
    setRetryQueue([...summary.uncertainOrFailedItems]);
    setRetryIndex(0);
    setBannerNotice(undefined);
  };

  const renderPageCard = () => {
    if (session.totalCount === 0) {
      return (
        <section className="continuous-review-complete" aria-live="polite">
          <Badge tone="neutral">暂无到期题</Badge>
          <h3>今天没有到期题</h3>
          <p>错题库中当前没有到期需要复习的题目。</p>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            {onOpenMistakeNotebook && (
              <Button
                variant="primary"
                size="sm"
                onClick={onOpenMistakeNotebook}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  menu_book
                </span>
                <span>查看错题本</span>
              </Button>
            )}
            {onOpenInstantMistake && (
              <Button
                variant={onOpenMistakeNotebook ? "secondary" : "primary"}
                size="sm"
                onClick={onOpenInstantMistake}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  bolt
                </span>
                <span>立即刷错题</span>
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void onPrepare()}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                refresh
              </span>
              <span>检查与准备队列</span>
            </Button>
            <Button variant="text" size="sm" onClick={onManage}>
              查看方案
            </Button>
          </div>
        </section>
      );
    }

    if (!active || !session.activeScheme) {
      return (
        <section className="continuous-review-complete" aria-live="polite">
          <Badge tone="success">今日完成</Badge>
          <h3 aria-label="review progress">今天的错题已完成</h3>
          <p>
            {session.completedCount} 道反馈已保存，掌握率{" "}
            {summary.masteryPercent}%。
          </p>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            {onOpenMistakeNotebook && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onOpenMistakeNotebook}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  menu_book
                </span>
                <span>前往错题本巩固</span>
              </Button>
            )}
            {onOpenInstantMistake && (
              <Button
                variant="primary"
                size="sm"
                onClick={onOpenInstantMistake}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  bolt
                </span>
                <span>立即刷错题</span>
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onStartReview?.()}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                analytics
              </span>
              <span>查看本次复习结算</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || !session.latestCompletedQueueId}
              onClick={() =>
                session.latestCompletedQueueId &&
                void onUndo(session.latestCompletedQueueId)
              }
            >
              <span>撤销上一题</span>
            </Button>
            <Button variant="text" size="sm" onClick={onManage}>
              查看方案
            </Button>
          </div>
        </section>
      );
    }

    return (
      <section className="continuous-review-complete">
        <p>今日连续复习</p>
        <h3>
          {session.completedCount} / {session.totalCount}
        </h3>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <Button
            ref={prepareRef}
            variant="primary"
            size="md"
            disabled={busy}
            onClick={() => onStartReview?.()}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              play_arrow
            </span>
            {session.completedCount > 0 ? "继续连续复习" : "开始连续复习"}
          </Button>
          {onOpenInstantMistake && (
            <Button
              variant="secondary"
              size="md"
              onClick={onOpenInstantMistake}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                bolt
              </span>
              立即刷错题
            </Button>
          )}
          <Button
            variant="secondary"
            size="md"
            disabled={busy}
            onClick={() => void onPrepare()}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              refresh
            </span>
            刷新队列
          </Button>
        </div>
      </section>
    );
  };

  return (
    <>
      {renderPageCard()}
      {shouldOpen && (
        <EditorDialog
          title={
            inRetry
              ? "待巩固题目重练"
              : active
                ? "今日连续复习"
                : "今日复习完成结算"
          }
          description={
            inRetry
              ? `第 ${retryIndex + 1} / ${retryQueue?.length} 题 · 针对本次未完全掌握的题目进行二次巩固，按 1/2/3 重新评估掌握度`
              : active
                ? `${session.completedCount + 1} / ${session.totalCount}`
                : `本次已复习 ${summary.totalCount} 道错题，掌握率 ${summary.masteryPercent}%；做题反馈已同步至复习方案。`
          }
          dirty={false}
          onRequestClose={onClose}
          returnFocusRef={prepareRef}
          size={!inRetry && !active ? "large" : "review"}
        >
          {inRetry && effectiveActiveRetryItem ? (
            <QuestionReviewContent
              key={`retry-${effectiveActiveRetryItem.question.question.id}-${retryIndex}-${questionRegionsKey(effectiveActiveRetryItem.question.regions)}`}
              item={effectiveActiveRetryItem}
              queueId=""
              busy={busy}
              canUndo={retryIndex > 0}
              defaultRevealed
              onEditRegions={() =>
                void openRegionEditor(effectiveActiveRetryItem.question)
              }
              onFeedback={handleRetryFeedback}
              onUndo={handleRetryUndo}
            />
          ) : effectiveActive && session.activeScheme ? (
            <QuestionReviewContent
              key={`${effectiveActive.question.question.id}-${questionRegionsKey(effectiveActive.question.regions)}`}
              item={effectiveActive}
              queueId={session.activeScheme.queue?.id ?? ""}
              busy={busy}
              canUndo={!!session.latestCompletedQueueId}
              defaultRevealed
              onEditRegions={() =>
                void openRegionEditor(effectiveActive.question)
              }
              onFeedback={onFeedback}
              onUndo={onUndo}
            />
          ) : (
            <div className="paper-summary-card">
              <div className="paper-summary-stats-grid">
                <div className="paper-summary-stat-card">
                  <span className="paper-summary-stat-label">复习总数</span>
                  <strong className="paper-summary-stat-value">
                    {summary.totalCount}
                  </strong>
                </div>
                <div className="paper-summary-stat-card is-correct">
                  <span className="paper-summary-stat-label">完全掌握</span>
                  <strong className="paper-summary-stat-value">
                    {summary.masteredCount}
                  </strong>
                </div>
                <div className="paper-summary-stat-card is-uncertain">
                  <span className="paper-summary-stat-label">仍模糊</span>
                  <strong className="paper-summary-stat-value">
                    {summary.uncertainCount}
                  </strong>
                </div>
                <div className="paper-summary-stat-card is-incorrect">
                  <span className="paper-summary-stat-label">未掌握/不会</span>
                  <strong className="paper-summary-stat-value">
                    {summary.failedCount}
                  </strong>
                </div>
                <div className="paper-summary-stat-card is-accuracy">
                  <span className="paper-summary-stat-label">掌握率</span>
                  <strong className="paper-summary-stat-value">
                    {summary.masteryPercent}%
                  </strong>
                </div>
              </div>

              {bannerNotice ? (
                <div
                  className="review-scheme-notice"
                  style={{
                    padding: "8px 12px",
                    background: "var(--color-bg-subtle)",
                    borderRadius: "var(--radius-md)",
                    fontWeight: 600,
                  }}
                >
                  {bannerNotice}
                </div>
              ) : null}

              <div className="paper-summary-actions-strip">
                {summary.uncertainOrFailedItems.length > 0 ? (
                  <Button variant="primary" onClick={startRetry}>
                    <span
                      className="material-symbols-rounded"
                      aria-hidden="true"
                    >
                      replay
                    </span>
                    重练本次待巩固题目（
                    {summary.uncertainOrFailedItems.length} 题）
                  </Button>
                ) : null}
                {onOpenMistakeNotebook && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      onClose();
                      onOpenMistakeNotebook();
                    }}
                  >
                    <span
                      className="material-symbols-rounded"
                      aria-hidden="true"
                    >
                      menu_book
                    </span>
                    前往错题本巩固（{summary.uncertainOrFailedItems.length} 题）
                  </Button>
                )}
                {onOpenInstantMistake && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      onClose();
                      onOpenInstantMistake();
                    }}
                  >
                    <span
                      className="material-symbols-rounded"
                      aria-hidden="true"
                    >
                      bolt
                    </span>
                    立即刷更多错题
                  </Button>
                )}
                <Button variant="secondary" onClick={onManage}>
                  <span className="material-symbols-rounded" aria-hidden="true">
                    tune
                  </span>
                  查看方案
                </Button>
                <Button variant="ghost" onClick={onClose}>
                  完成并返回
                </Button>
              </div>

              {summary.uncertainOrFailedItems.length > 0 ? (
                <div className="paper-summary-error-list-section">
                  <h4 className="paper-summary-error-heading">
                    待巩固题目清单（
                    {summary.uncertainOrFailedItems.length} 题）
                  </h4>
                  <div className="paper-summary-error-list">
                    {summary.uncertainOrFailedItems.map((item, index) => {
                      const q = item.question.question;
                      const rating = item.rating;
                      return (
                        <div key={q.id} className="paper-summary-error-item">
                          <div className="paper-summary-error-info">
                            <span
                              className={`paper-summary-error-tag ${rating === "uncertain" ? "is-uncertain" : "is-incorrect"}`}
                            >
                              {rating === "uncertain" ? "模糊" : "不会"}
                            </span>
                            <strong className="paper-summary-error-title">
                              第 {index + 1} 题 · {q.title}
                            </strong>
                            <small className="paper-summary-error-meta">
                              {q.documentTitle}
                            </small>
                          </div>
                          <div className="paper-summary-error-item-actions">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setAiAnalysisQuestion(item)}
                            >
                              <span
                                className="material-symbols-rounded"
                                aria-hidden="true"
                              >
                                psychology
                              </span>
                              辅助解析
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    textAlign: "center",
                    padding: "24px 0",
                    color: "var(--color-success)",
                  }}
                >
                  <span
                    className="material-symbols-rounded"
                    style={{
                      fontSize: "2.2rem",
                      display: "block",
                      marginBottom: "6px",
                    }}
                    aria-hidden="true"
                  >
                    verified
                  </span>
                  <strong>
                    太棒了！本次复习已全部掌握，没有待巩固的错题。
                  </strong>
                </div>
              )}
            </div>
          )}
        </EditorDialog>
      )}
      {effectiveAiAnalysisQuestion !== undefined ? (
        <EditorDialog
          title="辅助参考解析"
          description={`${effectiveAiAnalysisQuestion.question.question.title} · ${effectiveAiAnalysisQuestion.question.question.documentTitle}`}
          dirty={false}
          onRequestClose={() => setAiAnalysisQuestion(undefined)}
          onRequestBack={() => setAiAnalysisQuestion(undefined)}
          backLabel="返回复习结算"
          backRequiresConfirmation={false}
          size="review"
        >
          <div className="mistake-preview-dialog-content">
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginBottom: "8px",
              }}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  void openRegionEditor(effectiveAiAnalysisQuestion.question)
                }
                title="调整题目在 PDF 中的框选区域"
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  crop
                </span>
                <span>调整题目区域</span>
              </Button>
            </div>
            <QuestionRegionCard
              key={`${effectiveAiAnalysisQuestion.question.question.id}-${questionRegionsKey(effectiveAiAnalysisQuestion.question.regions)}`}
              documentId={
                effectiveAiAnalysisQuestion.question.question.documentId
              }
              regions={effectiveAiAnalysisQuestion.question.regions}
              title={effectiveAiAnalysisQuestion.question.question.title}
            />
            <QuestionAiAnalysis
              question={effectiveAiAnalysisQuestion.question.question}
              regions={effectiveAiAnalysisQuestion.question.regions}
            />
          </div>
        </EditorDialog>
      ) : null}

      {editingRegionQuestion !== undefined && activeSnapshot !== undefined ? (
        <ManualIndexDialog
          snapshot={activeSnapshot}
          existingQuestion={editingRegionQuestion}
          onClose={() => setEditingRegionQuestion(undefined)}
          onSaved={handleRegionSaved}
        />
      ) : null}
    </>
  );
}

export function QuestionReviewContent({
  item,
  queueId,
  busy,
  canUndo,
  defaultRevealed = true,
  onEditRegions,
  onFeedback,
  onUndo,
}: {
  item: ReviewSchemeQueueItem;
  queueId: string;
  busy: boolean;
  canUndo: boolean;
  defaultRevealed?: boolean;
  onEditRegions?(): void;
  onFeedback(
    queueId: string,
    questionId: string,
    rating: ReviewSchemeRating,
  ): Promise<boolean>;
  onUndo(queueId: string): Promise<boolean>;
}) {
  const ref = useRef<HTMLElement>(null);
  const q = item.question.question;
  const [revealed, setRevealed] = useState(defaultRevealed);

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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h4 style={{ margin: 0 }}>{q.title}</h4>
        {onEditRegions && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onEditRegions}
            title="调整题目在 PDF 中的框选区域"
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              crop
            </span>
            <span>调整题目区域</span>
          </Button>
        )}
      </div>

      <QuestionRegionCard
        key={`${q.id}-${questionRegionsKey(item.question.regions)}`}
        documentId={q.documentId}
        title={q.title}
        regions={item.question.regions}
      />

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
