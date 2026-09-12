import { useMemo, useState } from "react";
import { EditorDialog } from "../../shared/components/EditorDialog";
import { Button } from "../../shared/ui/Button";
import {
  recordBulkQuestionAttempts,
  type IndexedQuestion,
  type QuestionBankSnapshot,
} from "../../shared/tauri/questionBankClient";
import type { AttemptResult } from "../../shared/tauri/questionClient";
import type { ReviewSchemeRating } from "../../shared/tauri/reviewSchemeClient";
import { QuestionReviewContent } from "./ContinuousReviewPanel";
import { QuestionAiAnalysis } from "./QuestionAiAnalysis";
import {
  indexedQuestionToReviewItem,
  selectInstantMistakeQuestions,
} from "./instantMistakeModel";

export function InstantMistakeDrillDialog({
  questions,
  allQuestions,
  today,
  targetCount,
  subjectId,
  workbookId,
  onClose,
  onComplete,
  onSnapshotUpdated,
}: {
  questions: IndexedQuestion[];
  allQuestions: IndexedQuestion[];
  today: string;
  targetCount: number;
  subjectId?: string;
  workbookId?: string;
  onClose(): void;
  onComplete?(): void;
  onSnapshotUpdated?(snapshot: QuestionBankSnapshot): void;
}) {
  const [currentBatch, setCurrentBatch] =
    useState<IndexedQuestion[]>(questions);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [ratings, setRatings] = useState<Record<string, ReviewSchemeRating>>(
    {},
  );
  const [seenIds, setSeenIds] = useState<Set<string>>(
    () => new Set(questions.map((q) => q.id)),
  );
  const [poolQuestions, setPoolQuestions] =
    useState<IndexedQuestion[]>(allQuestions);
  const [busy, setBusy] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [bannerNotice, setBannerNotice] = useState<string>();

  // Retry state for uncertain/failed questions in this session
  const [retryQueue, setRetryQueue] = useState<IndexedQuestion[]>();
  const [retryIndex, setRetryIndex] = useState(0);

  // AI analysis modal for review
  const [aiAnalysisQuestion, setAiAnalysisQuestion] =
    useState<IndexedQuestion>();

  const inRetry = retryQueue !== undefined && retryIndex < retryQueue.length;
  const activeRetryQuestion = inRetry ? retryQueue[retryIndex] : undefined;
  const activeQuestion =
    !isFinished && currentIndex < currentBatch.length
      ? currentBatch[currentIndex]
      : undefined;

  const summary = useMemo(() => {
    let masteredCount = 0;
    let uncertainCount = 0;
    let failedCount = 0;
    const uncertainOrFailed: IndexedQuestion[] = [];

    for (const q of currentBatch) {
      const rating = ratings[q.id];
      if (rating === "mastered") {
        masteredCount += 1;
      } else if (rating === "uncertain") {
        uncertainCount += 1;
        uncertainOrFailed.push(q);
      } else if (rating === "failed") {
        failedCount += 1;
        uncertainOrFailed.push(q);
      }
    }

    const totalCount = currentBatch.length;
    const masteryPercent =
      totalCount === 0 ? 0 : Math.round((masteredCount / totalCount) * 100);

    return {
      totalCount,
      masteredCount,
      uncertainCount,
      failedCount,
      masteryPercent,
      uncertainOrFailed,
    };
  }, [currentBatch, ratings]);

  const handleFeedback = async (
    _queueId: string,
    questionId: string,
    rating: ReviewSchemeRating,
  ) => {
    if (busy) return false;
    setBusy(true);

    try {
      // Map ReviewSchemeRating to QuestionBank AttemptResult
      const result: AttemptResult =
        rating === "mastered"
          ? "correct"
          : rating === "uncertain"
            ? "uncertain"
            : "incorrect";

      // Persist attempt immediately into SQLite database
      const updatedSnapshot = await recordBulkQuestionAttempts(today, [
        { questionId, result },
      ]);
      setPoolQuestions(updatedSnapshot.questions);
      onSnapshotUpdated?.(updatedSnapshot);

      if (inRetry) {
        setRatings((prev) => ({ ...prev, [questionId]: rating }));
        if (retryIndex + 1 >= (retryQueue?.length ?? 0)) {
          setRetryQueue(undefined);
          setBannerNotice("本次待巩固错题重练完成！掌握状态已即时更新。");
        } else {
          setRetryIndex((idx) => idx + 1);
        }
      } else {
        setRatings((prev) => ({ ...prev, [questionId]: rating }));
        if (currentIndex + 1 >= currentBatch.length) {
          setIsFinished(true);
        } else {
          setCurrentIndex((idx) => idx + 1);
        }
      }
      return true;
    } catch (err) {
      console.error("Failed to record mistake drill attempt:", err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleUndo = async () => {
    if (inRetry) {
      if (retryIndex > 0) {
        setRetryIndex((idx) => idx - 1);
      }
    } else {
      if (currentIndex > 0) {
        setCurrentIndex((idx) => idx - 1);
      }
    }
    return true;
  };

  const startRetry = () => {
    if (summary.uncertainOrFailed.length === 0) return;
    setRetryQueue([...summary.uncertainOrFailed]);
    setRetryIndex(0);
    setBannerNotice(undefined);
  };

  const handleAnotherBatch = () => {
    const updatedSeen = new Set(seenIds);
    for (const q of currentBatch) {
      updatedSeen.add(q.id);
    }
    setSeenIds(updatedSeen);

    const nextBatch = selectInstantMistakeQuestions(poolQuestions, {
      count: targetCount,
      subjectId,
      workbookId,
      avoidQuestionIds: updatedSeen,
    });

    if (nextBatch.length === 0) {
      setBannerNotice("错题池中暂无更多新错题！");
      return;
    }

    setCurrentBatch(nextBatch);
    setCurrentIndex(0);
    setRatings({});
    setIsFinished(false);
    setRetryQueue(undefined);
    setBannerNotice(undefined);
  };

  const handleFinish = () => {
    onComplete?.();
    onClose();
  };

  const dialogTitle = inRetry
    ? `待巩固错题重练（${retryIndex + 1} / ${retryQueue?.length} 题）`
    : !isFinished
      ? `错题即时特训（${currentIndex + 1} / ${currentBatch.length} 题）`
      : "错题即时特训完成结算";

  const dialogDesc = inRetry
    ? "针对本次未完全掌握的题目进行二次巩固"
    : !isFinished
      ? undefined
      : `本次已刷 ${summary.totalCount} 道错题，掌握率 ${summary.masteryPercent}%；作答反馈已实时同步至数据库。`;

  return (
    <>
      <EditorDialog
        title={dialogTitle}
        description={dialogDesc}
        dirty={false}
        onRequestClose={onClose}
        size={!inRetry && isFinished ? "large" : "review"}
      >
        {inRetry && activeRetryQuestion ? (
          <QuestionReviewContent
            key={`retry-${activeRetryQuestion.id}-${retryIndex}`}
            item={indexedQuestionToReviewItem(
              activeRetryQuestion,
              retryIndex,
              ratings[activeRetryQuestion.id],
            )}
            queueId={activeRetryQuestion.id}
            busy={busy}
            canUndo={retryIndex > 0}
            defaultRevealed
            onFeedback={handleFeedback}
            onUndo={handleUndo}
          />
        ) : !isFinished && activeQuestion ? (
          <QuestionReviewContent
            key={`drill-${activeQuestion.id}-${currentIndex}`}
            item={indexedQuestionToReviewItem(
              activeQuestion,
              currentIndex,
              ratings[activeQuestion.id],
            )}
            queueId={activeQuestion.id}
            busy={busy}
            canUndo={currentIndex > 0}
            defaultRevealed
            onFeedback={handleFeedback}
            onUndo={handleUndo}
          />
        ) : (
          <div className="paper-summary-card">
            <div className="paper-summary-stats-grid">
              <div className="paper-summary-stat-card">
                <span className="paper-summary-stat-label">特训总数</span>
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
                <span className="paper-summary-stat-label">未掌握/做错</span>
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
                  marginBottom: "1rem",
                }}
              >
                {bannerNotice}
              </div>
            ) : null}

            <div className="paper-summary-actions-strip">
              {summary.uncertainOrFailed.length > 0 ? (
                <Button variant="primary" onClick={startRetry}>
                  <span className="material-symbols-rounded" aria-hidden="true">
                    replay
                  </span>
                  重练本次待巩固题目（{summary.uncertainOrFailed.length} 题）
                </Button>
              ) : null}
              <Button variant="secondary" onClick={handleAnotherBatch}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  autorenew
                </span>
                再来一组（{targetCount} 题）
              </Button>
              <Button variant="ghost" onClick={handleFinish}>
                完成特训并返回
              </Button>
            </div>

            {summary.uncertainOrFailed.length > 0 ? (
              <div className="paper-summary-error-list-section">
                <h4 className="paper-summary-error-heading">
                  待巩固错题清单（{summary.uncertainOrFailed.length} 题）
                </h4>
                <div className="paper-summary-error-list">
                  {summary.uncertainOrFailed.map((q, index) => {
                    const rating = ratings[q.id];
                    return (
                      <div key={q.id} className="paper-summary-error-item">
                        <div className="paper-summary-error-info">
                          <span
                            className={`paper-summary-error-tag ${rating === "uncertain" ? "is-uncertain" : "is-incorrect"}`}
                          >
                            {rating === "uncertain" ? "模糊" : "做错"}
                          </span>
                          <strong className="paper-summary-error-title">
                            第 {index + 1} 题 · {q.title}
                          </strong>
                          <small className="paper-summary-error-meta">
                            {q.documentTitle} · {q.chapter}
                          </small>
                        </div>
                        <div className="paper-summary-error-item-actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setAiAnalysisQuestion(q)}
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
                <strong>太棒了！本次特训题目已全部攻克，无待巩固错题。</strong>
              </div>
            )}
          </div>
        )}
      </EditorDialog>

      {aiAnalysisQuestion !== undefined ? (
        <EditorDialog
          title="辅助参考解析"
          description={`${aiAnalysisQuestion.title} · ${aiAnalysisQuestion.documentTitle}`}
          dirty={false}
          onRequestClose={() => setAiAnalysisQuestion(undefined)}
          onRequestBack={() => setAiAnalysisQuestion(undefined)}
          backLabel="返回特训结算"
          backRequiresConfirmation={false}
          size="review"
        >
          <QuestionAiAnalysis
            question={{
              id: aiAnalysisQuestion.id,
              documentId: aiAnalysisQuestion.documentId,
              documentTitle: aiAnalysisQuestion.documentTitle,
              title: aiAnalysisQuestion.title,
              questionType: aiAnalysisQuestion.questionType,
            }}
            regions={aiAnalysisQuestion.regions}
          />
        </EditorDialog>
      ) : null}
    </>
  );
}
