import { useEffect, useState } from "react";
import {
  getQuestionHistory,
  type AttemptResult,
  type QuestionHistory,
} from "../../shared/tauri/questionClient";
import { Badge, type BadgeTone } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";

export function formatAttemptDuration(seconds?: number): string | undefined {
  if (seconds === undefined || seconds <= 0) return undefined;
  if (seconds < 60) return `${seconds} 秒`;
  const mins = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  return remainingSecs > 0 ? `${mins} 分 ${remainingSecs} 秒` : `${mins} 分钟`;
}

export function formatTimelineTimestamp(
  timestamp: number,
  now = Date.now(),
): { relative: string; full: string } {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const full = `${year}-${month}-${day} ${hours}:${minutes}`;

  const diffMs = now - timestamp;
  if (diffMs < 0) return { relative: full, full };

  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return { relative: "刚刚", full };

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return { relative: `${diffMinutes} 分钟前`, full };

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return { relative: `${diffHours} 小时前`, full };

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return { relative: "昨天", full };
  if (diffDays === 2) return { relative: "前天", full };
  if (diffDays < 30) return { relative: `${diffDays} 天前`, full };

  return { relative: `${year}-${month}-${day}`, full };
}

export function getMasteryMeta(mastery?: string): {
  label: string;
  tone: BadgeTone;
} {
  switch (mastery) {
    case "mastered":
      return { label: "已攻克", tone: "success" };
    case "learning":
      return { label: "待攻克", tone: "warning" };
    case "uncertain":
      return { label: "模糊待复习", tone: "warning" };
    case "new":
      return { label: "新加入", tone: "info" };
    default:
      return { label: "练习中", tone: "neutral" };
  }
}

export function getAttemptResultMeta(result: AttemptResult): {
  label: string;
  tone: BadgeTone;
  icon: string;
} {
  switch (result) {
    case "correct":
      return { label: "做对", tone: "success", icon: "check_circle" };
    case "uncertain":
      return { label: "模糊", tone: "warning", icon: "help" };
    case "incorrect":
      return { label: "做错", tone: "danger", icon: "cancel" };
  }
}

export function getReviewRatingMeta(rating?: string):
  | {
      label: string;
      tone: BadgeTone;
    }
  | undefined {
  switch (rating) {
    case "mastered":
      return { label: "完全掌握", tone: "success" };
    case "uncertain":
      return { label: "有些模糊", tone: "warning" };
    case "failed":
      return { label: "不会做", tone: "danger" };
    case "skipped":
      return { label: "跳过", tone: "neutral" };
    default:
      return undefined;
  }
}

export function extractErrorMessage(
  err: unknown,
  fallback = "获取题目做题轨迹失败",
): string {
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  if (typeof err === "object" && err !== null) {
    const candidate = err as Record<string, unknown>;
    if (
      typeof candidate.message === "string" &&
      candidate.message.trim().length > 0
    ) {
      return candidate.message;
    }
  }
  if (typeof err === "string" && err.trim().length > 0) {
    return err;
  }
  return fallback;
}

export interface QuestionAttemptTimelineProps {
  questionId: string;
  className?: string;
  refreshKey?: number | string;
}

export function QuestionAttemptTimeline({
  questionId,
  className,
  refreshKey,
}: QuestionAttemptTimelineProps) {
  const currentKey = `${questionId}:${refreshKey ?? ""}`;
  const [fetchState, setFetchState] = useState<{
    key: string;
    loading: boolean;
    error: string | null;
    history: QuestionHistory | null;
  }>({
    key: currentKey,
    loading: true,
    error: null,
    history: null,
  });
  const [isExpanded, setIsExpanded] = useState(true);

  const isCurrent = fetchState.key === currentKey;
  const loading = !isCurrent || fetchState.loading;
  const error = isCurrent ? fetchState.error : null;
  const history = isCurrent ? fetchState.history : null;

  useEffect(() => {
    let cancelled = false;

    getQuestionHistory(questionId)
      .then((data) => {
        if (!cancelled) {
          setFetchState({
            key: currentKey,
            loading: false,
            error: null,
            history: data,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchState({
            key: currentKey,
            loading: false,
            error: extractErrorMessage(err, "获取题目做题轨迹失败"),
            history: null,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [questionId, refreshKey, currentKey]);

  const handleRetry = () => {
    setFetchState({
      key: currentKey,
      loading: true,
      error: null,
      history: null,
    });
    getQuestionHistory(questionId)
      .then((data) => {
        setFetchState({
          key: currentKey,
          loading: false,
          error: null,
          history: data,
        });
      })
      .catch((err) => {
        setFetchState({
          key: currentKey,
          loading: false,
          error: extractErrorMessage(err, "重试失败"),
          history: null,
        });
      });
  };

  if (loading) {
    return (
      <div className={`question-timeline-card loading ${className ?? ""}`}>
        <div className="question-timeline-loading">
          <span
            className="material-symbols-rounded spin-icon"
            aria-hidden="true"
          >
            progress_activity
          </span>
          <span>加载做题轨迹与复习历史...</span>
        </div>
      </div>
    );
  }

  if (error || !history) {
    return (
      <div className={`question-timeline-card error ${className ?? ""}`}>
        <div className="question-timeline-error">
          <span className="material-symbols-rounded" aria-hidden="true">
            error_outline
          </span>
          <span>{error ?? "暂无做题历史数据"}</span>
          <Button size="sm" variant="secondary" onClick={handleRetry}>
            重试
          </Button>
        </div>
      </div>
    );
  }

  const masteryMeta = getMasteryMeta(history.masteryLevel);
  const hasAttempts = history.attempts.length > 0;
  const firstMistakeFormatted = history.firstMistakeAt
    ? formatTimelineTimestamp(history.firstMistakeAt).full.split(" ")[0]
    : "无失分记录";

  return (
    <section
      className={`question-timeline-card ${isExpanded ? "is-expanded" : "is-collapsed"} ${className ?? ""}`}
      aria-label="做题轨迹与历史时间线"
    >
      <header className="question-timeline-header">
        <div className="question-timeline-title-row">
          <div className="question-timeline-title">
            <span className="material-symbols-rounded" aria-hidden="true">
              timeline
            </span>
            <h4>做题轨迹与历史时间线</h4>
            <Badge tone={masteryMeta.tone}>{masteryMeta.label}</Badge>
            {history.successfulStreak > 0 ? (
              <Badge tone="success" title="当前连续做对次数">
                <span
                  className="material-symbols-rounded inline-icon"
                  aria-hidden="true"
                >
                  local_fire_department
                </span>
                连对 {history.successfulStreak} 次
              </Badge>
            ) : null}
            {!isExpanded ? (
              <span className="question-timeline-collapsed-hint">
                （共 {history.attempts.length} 次作答，已收起）
              </span>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-expanded={isExpanded}
            title={isExpanded ? "收起轨迹时间线" : "展开轨迹时间线"}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              {isExpanded ? "expand_less" : "expand_more"}
            </span>
            <span>{isExpanded ? "收起" : "展开"}</span>
          </Button>
        </div>

        {/* Trajectory Overview Metrics */}
        {isExpanded ? (
          <div className="question-timeline-metrics">
            <div className="question-timeline-metric-item">
              <span className="metric-label">累计做题</span>
              <strong className="metric-value">
                {history.attempts.length} 次
              </strong>
            </div>
            <div className="question-timeline-metric-item">
              <span className="metric-label">做错次数</span>
              <strong className="metric-value danger">
                {history.mistakeCount} 次
              </strong>
            </div>
            <div className="question-timeline-metric-item">
              <span className="metric-label">首次失分</span>
              <span className="metric-text">{firstMistakeFormatted}</span>
            </div>
            {history.dueDate ? (
              <div className="question-timeline-metric-item">
                <span className="metric-label">下次复习</span>
                <span className="metric-text highlight">{history.dueDate}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {isExpanded ? (
        <div className="question-timeline-body">
          {!hasAttempts ? (
            <div className="question-timeline-empty">
              <span className="material-symbols-rounded" aria-hidden="true">
                history
              </span>
              <p>暂无作答与复习打卡记录</p>
              <small>在练习或每日复习中作答后，时间线将自动呈现演进轨迹</small>
            </div>
          ) : (
            <ol className="question-timeline-list">
              {history.attempts.map((attempt, index) => {
                const resultMeta = getAttemptResultMeta(attempt.result);
                const reviewMeta = getReviewRatingMeta(attempt.reviewRating);
                const durationText = formatAttemptDuration(
                  attempt.durationSeconds,
                );
                const { relative, full } = formatTimelineTimestamp(
                  attempt.attemptedAt,
                );
                const isReviewEvent = Boolean(attempt.reviewRating);

                return (
                  <li
                    key={attempt.id || `${attempt.attemptedAt}-${index}`}
                    className={`question-timeline-item tone-${resultMeta.tone}`}
                  >
                    {/* Visual node line & dot */}
                    <div className="timeline-node-rail" aria-hidden="true">
                      <div
                        className={`timeline-node-dot tone-${resultMeta.tone}`}
                      >
                        <span className="material-symbols-rounded">
                          {resultMeta.icon}
                        </span>
                      </div>
                      {index < history.attempts.length - 1 ? (
                        <div className="timeline-node-line" />
                      ) : null}
                    </div>

                    {/* Content card */}
                    <div className="timeline-node-content">
                      <div className="timeline-node-header">
                        <div className="timeline-node-tags">
                          <Badge tone={resultMeta.tone}>
                            {resultMeta.label}
                          </Badge>
                          {isReviewEvent ? (
                            <Badge tone="info" className="timeline-mode-badge">
                              <span
                                className="material-symbols-rounded inline-icon"
                                aria-hidden="true"
                              >
                                event_repeat
                              </span>
                              复习打卡
                            </Badge>
                          ) : (
                            <Badge
                              tone="neutral"
                              className="timeline-mode-badge"
                            >
                              <span
                                className="material-symbols-rounded inline-icon"
                                aria-hidden="true"
                              >
                                edit_note
                              </span>
                              自主练习
                            </Badge>
                          )}
                          {reviewMeta ? (
                            <span className="timeline-review-rating">
                              评定：{reviewMeta.label}
                            </span>
                          ) : null}
                        </div>
                        <time
                          className="timeline-node-time"
                          dateTime={new Date(attempt.attemptedAt).toISOString()}
                          title={full}
                        >
                          {relative}
                          <span className="timeline-node-full-date">
                            ({full})
                          </span>
                        </time>
                      </div>

                      <div className="timeline-node-details">
                        {durationText ? (
                          <div className="timeline-node-detail-item">
                            <span
                              className="material-symbols-rounded inline-icon"
                              aria-hidden="true"
                            >
                              timer
                            </span>
                            <span>用时 {durationText}</span>
                          </div>
                        ) : null}

                        {attempt.nextDueDate ? (
                          <div className="timeline-node-detail-item">
                            <span
                              className="material-symbols-rounded inline-icon"
                              aria-hidden="true"
                            >
                              schedule
                            </span>
                            <span>
                              下次排期：{attempt.nextDueDate}
                              {attempt.intervalDays !== undefined
                                ? `（间隔 ${attempt.intervalDays} 天）`
                                : ""}
                            </span>
                          </div>
                        ) : null}

                        {attempt.answerNote ? (
                          <blockquote className="timeline-node-note">
                            <div className="timeline-node-note-label">
                              <span
                                className="material-symbols-rounded inline-icon"
                                aria-hidden="true"
                              >
                                notes
                              </span>
                              作答笔记与心得
                            </div>
                            <p>{attempt.answerNote}</p>
                          </blockquote>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
}
