import { useEffect, useState, type FormEvent } from "react";

import { localDateForTimezone } from "../../shared/tauri/scheduleClient";
import {
  generateDailyReviewQueue,
  getReviewDashboard,
  insertDailyReviewItem,
  normalizeReviewError,
  pinQuestionReview,
  setQuestionReview,
  submitReviewResult,
  updateReviewPreferences,
  type DailyReviewItem,
  type ReviewCommandError,
  type ReviewDashboard,
  type ReviewQuestion,
  type ReviewRating,
  type ReviewReason,
} from "../../shared/tauri/reviewClient";
import { getWorkspaceStatus } from "../../shared/tauri/workspaceClient";

export function ReviewPanel() {
  const [dashboard, setDashboard] = useState<ReviewDashboard>();
  const [today, setToday] = useState("");
  const [quota, setQuota] = useState("5");
  const [earlyFillEnabled, setEarlyFillEnabled] = useState(false);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReviewCommandError>();

  const refresh = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const loaded = await loadReviewState();
      setToday(loaded.today);
      setDashboard(loaded.dashboard);
      setQuota(String(loaded.dashboard.preferences.dailyQuota));
      setEarlyFillEnabled(loaded.dashboard.preferences.earlyFillEnabled);
    } catch (loadError: unknown) {
      setError(normalizeReviewError(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void loadReviewState().then(
      (loaded) => {
        if (active) {
          setToday(loaded.today);
          setDashboard(loaded.dashboard);
          setQuota(String(loaded.dashboard.preferences.dailyQuota));
          setEarlyFillEnabled(loaded.dashboard.preferences.earlyFillEnabled);
          setLoading(false);
        }
      },
      (loadError: unknown) => {
        if (active) {
          setError(normalizeReviewError(loadError));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const run = async (
    operation: () => Promise<ReviewDashboard>,
  ): Promise<ReviewDashboard | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      const saved = await operation();
      setDashboard(saved);
      return saved;
    } catch (operationError: unknown) {
      setError(normalizeReviewError(operationError));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const queue = dashboard?.queue;
  const selectedItem =
    queue?.items.find(
      (item) =>
        item.question.question.id === selectedQuestionId &&
        item.state === "pending",
    ) ?? queue?.items.find((item) => item.state === "pending");
  const queuedIds = new Set(
    queue?.items.map((item) => item.question.question.id) ?? [],
  );

  const savePreferences = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await run(() =>
      updateReviewPreferences({
        dailyQuota: Number(quota),
        earlyFillEnabled,
        today,
      }),
    );
  };

  const generateQueue = async () => {
    const saved = await run(() =>
      generateDailyReviewQueue({ queueDate: today, quota: Number(quota) }),
    );
    setSelectedQuestionId(
      saved?.queue?.items.find((item) => item.state === "pending")?.question
        .question.id,
    );
  };

  return (
    <section className="review-card" aria-labelledby="review-title">
      <div className="review-heading">
        <div>
          <p className="section-label">M6 · 错题复习</p>
          <h2 id="review-title">今天该复习哪些题</h2>
          <p>
            队列在生成时固定，按到期、错误历史和用户重要度排序，并说明每道题为什么出现。
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || loading}
          onClick={() => void refresh()}
        >
          刷新复习状态
        </button>
      </div>

      {error === undefined ? null : (
        <div className="error-detail" role="alert">
          <strong>{error.message}</strong>
          <p>{error.action}</p>
        </div>
      )}

      {loading || dashboard === undefined ? (
        <p className="empty-state">正在读取本地复习状态…</p>
      ) : (
        <>
          <ReviewSummary dashboard={dashboard} today={today} />

          <form className="review-preferences" onSubmit={savePreferences}>
            <label>
              默认每日数量
              <input
                type="number"
                min={1}
                max={100}
                value={quota}
                onChange={(event) => setQuota(event.target.value)}
              />
            </label>
            <label className="review-checkbox">
              <input
                type="checkbox"
                checked={earlyFillEnabled}
                onChange={(event) => setEarlyFillEnabled(event.target.checked)}
              />
              到期题不足时，用高优先级未到期题补足
            </label>
            <button type="submit" disabled={busy}>
              保存默认设置
            </button>
          </form>

          {queue === undefined ? (
            <div className="review-generate">
              <div>
                <h3>今天还没有固定队列</h3>
                <p>
                  本次将按 {quota || "0"}{" "}
                  道生成。生成后，新错题不会偷偷改变今天的顺序。
                </p>
              </div>
              <button type="button" disabled={busy} onClick={generateQueue}>
                生成今日复习队列
              </button>
            </div>
          ) : (
            <div className="review-queue-layout">
              <ReviewQueueList
                items={queue.items}
                selectedQuestionId={selectedItem?.question.question.id}
                onSelect={setSelectedQuestionId}
              />
              {selectedItem === undefined ? (
                <div className="review-finished">
                  <h3>今天的队列已经完成</h3>
                  <p>历史反馈已经保留，下一次到期日期不会因刷新而变化。</p>
                </div>
              ) : (
                <ReviewFeedback
                  key={selectedItem.question.question.id}
                  item={selectedItem}
                  busy={busy}
                  onSubmit={async (rating, durationSeconds, answerNote) => {
                    const saved = await run(() =>
                      submitReviewResult({
                        queueId: queue.id,
                        questionId: selectedItem.question.question.id,
                        rating,
                        today,
                        durationSeconds,
                        answerNote,
                      }),
                    );
                    if (saved !== undefined) {
                      setSelectedQuestionId(undefined);
                    }
                    return saved !== undefined;
                  }}
                />
              )}
            </div>
          )}

          <ActiveMistakeList
            questions={dashboard.activeQuestions}
            queueExists={queue !== undefined}
            queuedIds={queuedIds}
            today={today}
            busy={busy}
            onPriority={(question, userPriority) =>
              run(() =>
                setQuestionReview({
                  questionId: question.question.question.id,
                  active: true,
                  userPriority,
                  today,
                }),
              ).then((saved) => saved !== undefined)
            }
            onTogglePin={(question) =>
              run(() =>
                pinQuestionReview({
                  questionId: question.question.question.id,
                  pinDate:
                    question.state.manualPinDate === today ? undefined : today,
                  today,
                }),
              ).then((saved) => saved !== undefined)
            }
            onSuspend={(question) =>
              run(() =>
                setQuestionReview({
                  questionId: question.question.question.id,
                  active: false,
                  userPriority: question.profile.userPriority,
                  today,
                }),
              ).then((saved) => saved !== undefined)
            }
            onInsert={(question) =>
              run(() =>
                insertDailyReviewItem({
                  queueDate: today,
                  questionId: question.question.question.id,
                }),
              ).then((saved) => saved !== undefined)
            }
          />
        </>
      )}
    </section>
  );
}

async function loadReviewState(): Promise<{
  today: string;
  dashboard: ReviewDashboard;
}> {
  const workspace = await getWorkspaceStatus();
  if (workspace === null) {
    throw { code: "WORKSPACE_NOT_INITIALIZED" };
  }
  const today = localDateForTimezone(new Date(), workspace.timezone);
  return { today, dashboard: await getReviewDashboard(today) };
}

function ReviewSummary({
  dashboard,
  today,
}: {
  dashboard: ReviewDashboard;
  today: string;
}) {
  const summary = [
    ["激活错题", dashboard.backlog.activeCount],
    ["今日到期", dashboard.backlog.dueCount],
    ["已经逾期", dashboard.backlog.overdueCount],
    ["队列剩余", dashboard.backlog.queuedRemaining],
    ["预计清空", `${dashboard.backlog.estimatedClearDays} 天`],
  ] as const;
  return (
    <div className="review-summary" aria-label={`${today} 复习概况`}>
      {summary.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function ReviewQueueList({
  items,
  selectedQuestionId,
  onSelect,
}: {
  items: DailyReviewItem[];
  selectedQuestionId?: string;
  onSelect(questionId: string): void;
}) {
  if (items.length === 0) {
    return <p className="empty-state">今天没有需要进入队列的题目。</p>;
  }
  return (
    <div className="review-queue-list" aria-label="今日复习队列">
      {items.map((item) => {
        const question = item.question.question;
        const selected = question.id === selectedQuestionId;
        return (
          <button
            key={question.id}
            type="button"
            className={selected ? "review-queue-active" : undefined}
            disabled={item.state === "completed" || !item.available}
            onClick={() => onSelect(question.id)}
          >
            <span className="review-queue-position">{item.position + 1}</span>
            <span>
              <strong>{question.title}</strong>
              <small>{reasonText(item.reason).join(" · ")}</small>
            </span>
            <span className={`review-item-state review-item-${item.state}`}>
              {!item.available
                ? "来源不可用"
                : item.state === "completed"
                  ? "已完成"
                  : item.reason.isEarly
                    ? "提前"
                    : "待复习"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ReviewFeedback({
  item,
  busy,
  onSubmit,
}: {
  item: DailyReviewItem;
  busy: boolean;
  onSubmit(
    rating: ReviewRating,
    durationSeconds: number | undefined,
    answerNote: string | undefined,
  ): Promise<boolean>;
}) {
  const [rating, setRating] = useState<ReviewRating>("failed");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [answerNote, setAnswerNote] = useState("");
  const question = item.question.question;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const minutes =
      durationMinutes === "" ? undefined : Number(durationMinutes);
    await onSubmit(
      rating,
      rating === "skipped" || minutes === undefined
        ? undefined
        : Math.round(minutes * 60),
      rating === "skipped" ? undefined : optionalText(answerNote),
    );
  };

  return (
    <article className="review-feedback">
      <p className="section-label">
        {question.documentTitle} · 第{" "}
        {item.question.regions[0]?.pageNumber ?? "?"} 页
      </p>
      <h3>{question.title}</h3>
      <p>{reasonText(item.reason).join("；")}</p>
      {question.analysisMarkdown === undefined ? null : (
        <div className="review-analysis">
          <strong>个人解析</strong>
          <p>{question.analysisMarkdown}</p>
        </div>
      )}
      <form onSubmit={(event) => void submit(event)}>
        <label>
          本次反馈
          <select
            value={rating}
            onChange={(event) => setRating(event.target.value as ReviewRating)}
          >
            <option value="failed">未掌握（1 天后）</option>
            <option value="uncertain">不确定（3 天后）</option>
            <option value="mastered">掌握（按连续次数延长）</option>
            <option value="skipped">跳过（不记录作答）</option>
          </select>
        </label>
        <label>
          耗时（分钟，可选）
          <input
            type="number"
            min="0.1"
            max="1440"
            step="0.1"
            disabled={rating === "skipped"}
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
          />
        </label>
        <label className="review-feedback-note">
          本次答案与复盘
          <textarea
            rows={4}
            maxLength={10_000}
            disabled={rating === "skipped"}
            value={answerNote}
            onChange={(event) => setAnswerNote(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy || !item.available}>
          提交反馈并安排下次复习
        </button>
      </form>
    </article>
  );
}

interface ActiveMistakeListProps {
  questions: ReviewQuestion[];
  queueExists: boolean;
  queuedIds: Set<string>;
  today: string;
  busy: boolean;
  onPriority(question: ReviewQuestion, priority: number): Promise<boolean>;
  onTogglePin(question: ReviewQuestion): Promise<boolean>;
  onSuspend(question: ReviewQuestion): Promise<boolean>;
  onInsert(question: ReviewQuestion): Promise<boolean>;
}

function ActiveMistakeList({
  questions,
  queueExists,
  queuedIds,
  today,
  busy,
  onPriority,
  onTogglePin,
  onSuspend,
  onInsert,
}: ActiveMistakeListProps) {
  return (
    <details className="active-mistakes" open>
      <summary>全部激活错题（{questions.length}）</summary>
      {questions.length === 0 ? (
        <p className="empty-state">
          在习题册记录错误作答，或手动把题目加入错题复习后，会显示在这里。
        </p>
      ) : (
        <div className="active-mistake-list">
          {questions.map((question) => {
            const id = question.question.question.id;
            const pinned = question.state.manualPinDate === today;
            return (
              <article key={id} className="active-mistake-item">
                <div>
                  <strong>{question.question.question.title}</strong>
                  <span>
                    {question.question.question.documentTitle} · 到期{" "}
                    {question.state.dueDate} ·{" "}
                    {masteryLabel(question.state.mastery)}
                  </span>
                  <small>
                    错误 {question.profile.mistakeCount} 次 · 连续未掌握{" "}
                    {question.profile.consecutiveFailureCount} 次 · 连续掌握{" "}
                    {question.state.successfulStreak} 次
                  </small>
                </div>
                <div className="active-mistake-actions">
                  <label>
                    重要度
                    <select
                      value={question.profile.userPriority}
                      disabled={busy}
                      onChange={(event) =>
                        void onPriority(question, Number(event.target.value))
                      }
                    >
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void onTogglePin(question)}
                  >
                    {pinned ? "取消今日固定" : "固定到今天"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || !queueExists || queuedIds.has(id)}
                    onClick={() => void onInsert(question)}
                  >
                    {queuedIds.has(id) ? "已在今日队列" : "手动加入今日"}
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={busy}
                    onClick={() => void onSuspend(question)}
                  >
                    退出错题复习
                  </button>
                </div>
                {question.recentEvents.length === 0 ? null : (
                  <ul className="review-event-list">
                    {question.recentEvents.map((event) => (
                      <li key={event.id}>
                        {ratingLabel(event.rating)} · {event.intervalDays} 天后
                        · 下次 {event.nextDueDate}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      )}
    </details>
  );
}

function reasonText(reason: ReviewReason): string[] {
  const reasons: string[] = [];
  const selection = {
    pinned: "已固定到今天",
    overdue: "已经到期",
    due: "今天到期",
    new: "新错题首次复习",
    early: "到期不足，提前补足",
    manual: "手动加入今日队列",
  }[reason.selection];
  reasons.push(selection);
  if (reason.overdueDays > 0) {
    reasons.push(`逾期 ${reason.overdueDays} 天`);
  }
  if (reason.failureStreak > 0) {
    reasons.push(`连续 ${reason.failureStreak} 次未掌握`);
  }
  if (reason.mistakeCount > 0) {
    reasons.push(`历史错误 ${reason.mistakeCount} 次`);
  }
  if (reason.userPriority >= 4) {
    reasons.push(`重要度 ${reason.userPriority}`);
  }
  if (reason.knowledgeWeakness > 0) {
    reasons.push(
      reason.knowledgeWeakness === 2 ? "关联薄弱知识点" : "关联学习中知识点",
    );
  }
  return reasons;
}

function masteryLabel(value: ReviewQuestion["state"]["mastery"]): string {
  return {
    new: "新加入",
    learning: "学习中",
    uncertain: "不确定",
    mastered: "已掌握",
  }[value];
}

function ratingLabel(value: ReviewRating): string {
  return {
    mastered: "掌握",
    uncertain: "不确定",
    failed: "未掌握",
    skipped: "跳过",
  }[value];
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
