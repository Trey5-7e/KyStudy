import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  executeQuestionAiAnalysis,
  listQuestionAiAnalysisHistory,
  normalizeAiError,
  previewQuestionAiAnalysis,
  type AiCallPreview,
  type AiCallResult,
  type QuestionAiAnalysisHistoryEntry,
  type QuestionAiAnalysisRequest,
} from "../../shared/tauri/aiClient";
import type { QuestionRegion } from "../../shared/tauri/questionClient";
import { captureQuestionRegionDataUrls } from "./QuestionRegionCard";
import "./review.css";
import {
  analysisPrompt,
  loadQuestionAiPrompt,
  QUESTION_AI_INSTRUCTIONS_MAX_CHARS,
  questionAiInputFingerprint,
  questionAiPromptContext,
  questionAiSourceFingerprint,
  saveQuestionAiPrompt,
  type QuestionAiInput,
} from "./QuestionAiAnalysisModel";

interface PendingPreview {
  preview: AiCallPreview;
  request: QuestionAiAnalysisRequest;
  fingerprint: string;
  sourceFingerprint: string;
  prompt: string;
  promptContext: string;
  forceRefresh: boolean;
  promptPreviewStale: boolean;
}

function formatQuestionAiHistoryTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function QuestionAiAnalysis({
  question,
  regions,
}: {
  question: QuestionAiInput;
  regions: QuestionRegion[];
}) {
  const promptInputId = useId();
  const inputFingerprint = useMemo(
    () =>
      questionAiSourceFingerprint(
        question,
        regions,
        loadQuestionAiPrompt(question, regions.length),
      ),
    [question, regions],
  );
  const [pending, setPending] = useState<PendingPreview>();
  const [result, setResult] = useState<AiCallResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<QuestionAiAnalysisHistoryEntry[]>();
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const historyRequestIdRef = useRef(0);

  useEffect(
    () => () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      historyRequestIdRef.current += 1;
    },
    [],
  );
  useEffect(() => {
    requestIdRef.current += 1;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !mountedRef.current) return;
      setPending(undefined);
      setResult(undefined);
      setError("");
      setBusy(false);
      setCopyStatus("");
      setHistoryOpen(false);
      setHistory(undefined);
      setHistoryError("");
    });
    return () => {
      cancelled = true;
    };
  }, [inputFingerprint, question.id]);

  const loadHistory = async () => {
    const requestId = ++historyRequestIdRef.current;
    setHistoryOpen(true);
    setHistory(undefined);
    setHistoryBusy(true);
    setHistoryError("");
    try {
      const entries = await listQuestionAiAnalysisHistory(question.id);
      if (!mountedRef.current || requestId !== historyRequestIdRef.current)
        return;
      setHistory(entries);
    } catch (operationError: unknown) {
      if (!mountedRef.current || requestId !== historyRequestIdRef.current)
        return;
      const normalized = normalizeAiError(operationError);
      setHistoryError(`${normalized.message}${normalized.action}`);
    } finally {
      if (mountedRef.current && requestId === historyRequestIdRef.current)
        setHistoryBusy(false);
    }
  };

  const toggleHistory = () => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    void loadHistory();
  };

  const prepare = async (forceRefresh = false) => {
    const requestId = ++requestIdRef.current;
    const capturedFingerprint = inputFingerprint;
    setBusy(true);
    setError("");
    setCopyStatus("");
    try {
      const imageDataUrls = await captureQuestionRegionDataUrls(
        question.documentId,
        regions,
      );
      const promptContext = questionAiPromptContext(
        question,
        imageDataUrls.length,
      );
      const prompt = loadQuestionAiPrompt(question, imageDataUrls.length);
      const sourceFingerprint = questionAiSourceFingerprint(
        question,
        regions,
        prompt,
      );
      const request: QuestionAiAnalysisRequest = {
        prompt,
        imageDataUrls,
        maxOutputTokens: 800,
      };
      const fingerprint = questionAiInputFingerprint(
        question,
        regions,
        imageDataUrls,
      );
      const preview = await previewQuestionAiAnalysis(request);
      if (
        !mountedRef.current ||
        requestId !== requestIdRef.current ||
        capturedFingerprint !== inputFingerprint
      )
        return;
      setPending({
        preview,
        request,
        fingerprint,
        sourceFingerprint,
        prompt,
        promptContext,
        forceRefresh,
        promptPreviewStale: false,
      });
    } catch (operationError: unknown) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        const normalized = normalizeAiError(operationError);
        setError(`${normalized.message}${normalized.action}`);
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current)
        setBusy(false);
    }
  };

  const updatePromptPreview = async () => {
    const current = pending;
    if (!current) return;
    const requestId = ++requestIdRef.current;
    setBusy(true);
    setError("");
    try {
      const preview = await previewQuestionAiAnalysis(current.request);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setPending((latest) =>
        latest === current
          ? { ...latest, preview, promptPreviewStale: false }
          : latest,
      );
    } catch (operationError: unknown) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        const normalized = normalizeAiError(operationError);
        setError(`${normalized.message}${normalized.action}`);
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current)
        setBusy(false);
    }
  };

  const execute = async () => {
    const current = pending;
    if (
      !current ||
      !current.preview.allowed ||
      current.fingerprint !==
        questionAiInputFingerprint(
          question,
          regions,
          current.request.imageDataUrls,
        )
    )
      return;
    const requestId = ++requestIdRef.current;
    setBusy(true);
    setError("");
    try {
      const nextResult = await executeQuestionAiAnalysis(
        question.id,
        current.sourceFingerprint,
        current.request,
        current.forceRefresh,
      );
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setResult(nextResult);
      setPending(undefined);
      setHistoryOpen(false);
      setHistory(undefined);
    } catch (operationError: unknown) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        const normalized = normalizeAiError(operationError);
        setError(`${normalized.message}${normalized.action}`);
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current)
        setBusy(false);
    }
  };

  return (
    <section className="question-ai-analysis" aria-label="AI 题目分析">
      {pending === undefined ? (
        <div className="question-ai-toolbar">
          {result === undefined ? (
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void prepare()}
            >
              {busy ? "正在准备题目图片…" : "AI 分析"}
            </button>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={toggleHistory}
          >
            {historyOpen
              ? "收起历史解析"
              : `历史解析${history === undefined ? "" : `（${history.length}）`}`}
          </button>
        </div>
      ) : null}
      {historyOpen && pending === undefined ? (
        <div className="question-ai-history" aria-label="历史 AI 解析">
          <header>
            <strong>历史 AI 解析</strong>
          </header>
          {historyBusy ? (
            <p className="question-ai-status" role="status">
              正在读取历史解析…
            </p>
          ) : null}
          {historyError === "" ? null : (
            <p className="mindmap-form-error" role="alert">
              {historyError}
            </p>
          )}
          {!historyBusy && history?.length === 0 ? (
            <p className="question-ai-status">
              暂无历史 AI 解析。完成一次分析后，这里会保留记录。
            </p>
          ) : null}
          {!historyBusy && history !== undefined && history.length > 0 ? (
            <div className="question-ai-history-list">
              {history.map((entry, index) => (
                <article
                  className="question-ai-history-item"
                  key={entry.result.callId}
                >
                  <header>
                    <strong>第 {history.length - index} 次解析</strong>
                    <span>
                      {formatQuestionAiHistoryTime(entry.result.finishedAt)} ·{" "}
                      {entry.result.inputTokens + entry.result.outputTokens}{" "}
                      Token
                    </span>
                  </header>
                  <div className="question-ai-history-text">
                    {entry.result.responseText}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {pending === undefined ? null : (
        <div className="question-ai-confirm">
          <strong>
            确认发送 {pending.request.imageDataUrls.length} 张题目图片？
          </strong>
          <p>
            {pending.preview.destination} · 预计最多{" "}
            {pending.preview.projectedTokens}{" "}
            Token。图片按题目区域顺序发送，不发送整个 PDF。
          </p>
          <div className="question-ai-prompt-editor">
            <div className="question-ai-prompt-field">
              <label htmlFor={promptInputId}>
                可编辑完整提示词（会同步用于组卷题和错题复习）
              </label>
              <textarea
                id={promptInputId}
                rows={10}
                maxLength={QUESTION_AI_INSTRUCTIONS_MAX_CHARS}
                value={pending.prompt}
                disabled={busy}
                onChange={(event) => {
                  const prompt = event.target.value;
                  saveQuestionAiPrompt(prompt, pending.promptContext);
                  setPending((current) =>
                    current === pending
                      ? {
                          ...current,
                          prompt,
                          sourceFingerprint: questionAiSourceFingerprint(
                            question,
                            regions,
                            prompt,
                          ),
                          promptPreviewStale: true,
                          request: {
                            ...current.request,
                            prompt,
                          },
                        }
                      : current,
                  );
                }}
              />
            </div>
            <p className="question-ai-prompt-help">
              题目、来源、题型和图片数量会随当前题目自动更新；修改提示词后请更新
              Token 预览。
            </p>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                const prompt = analysisPrompt(
                  question,
                  pending.request.imageDataUrls.length,
                );
                const promptContext = questionAiPromptContext(
                  question,
                  pending.request.imageDataUrls.length,
                );
                saveQuestionAiPrompt(prompt, promptContext);
                setPending((current) =>
                  current === pending
                    ? {
                        ...current,
                        prompt,
                        promptContext,
                        sourceFingerprint: questionAiSourceFingerprint(
                          question,
                          regions,
                          prompt,
                        ),
                        promptPreviewStale: true,
                        request: {
                          ...current.request,
                          prompt,
                        },
                      }
                    : current,
                );
              }}
            >
              恢复默认提示词
            </button>
          </div>
          {pending.promptPreviewStale ? (
            <div className="question-ai-prompt-stale">
              <span>提示词已修改，请先更新 Token 预览。</span>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void updatePromptPreview()}
              >
                更新 Token 预览
              </button>
            </div>
          ) : null}
          {pending.preview.warnings.length === 0 ? null : (
            <p>
              本次调用将触及 Token 预算：{pending.preview.warnings.join(", ")}。
            </p>
          )}
          <div>
            <button
              type="button"
              disabled={
                busy || !pending.preview.allowed || pending.promptPreviewStale
              }
              onClick={() => void execute()}
            >
              确认发送并分析
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setPending(undefined)}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {result === undefined ? null : (
        <article className="question-ai-result">
          <header>
            <strong>AI 参考解析</strong>
            <div className="question-ai-result-meta">
              <span>
                {result.cacheHit
                  ? "已保存解析 · 0 Token"
                  : `本次 ${result.inputTokens + result.outputTokens} Token`}
              </span>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void prepare(true)}
              >
                重新解析
              </button>
            </div>
          </header>
          <p className="question-ai-warning">
            请自行核对结论；这不是练习册标准答案，也不会影响错题推荐算法。
          </p>
          <div className="question-ai-text">{result.responseText}</div>
          <div className="question-ai-result-actions">
            <button
              type="button"
              className="text-button"
              onClick={() => {
                if (!navigator.clipboard) {
                  setCopyStatus("当前环境不支持自动复制，请手动选择文本复制。");
                  return;
                }
                void navigator.clipboard.writeText(result.responseText).then(
                  () => setCopyStatus("解析已复制。"),
                  () => setCopyStatus("复制失败，请手动选择文本复制。"),
                );
              }}
            >
              复制解析
            </button>
          </div>
          {copyStatus === "" ? null : (
            <span className="question-ai-status" role="status">
              {copyStatus}
            </span>
          )}
        </article>
      )}
      {error === "" ? null : (
        <p className="mindmap-form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
