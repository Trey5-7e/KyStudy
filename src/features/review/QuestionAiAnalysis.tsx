import { useEffect, useMemo, useRef, useState } from "react";

import {
  executeQuestionAiAnalysis,
  normalizeAiError,
  previewQuestionAiAnalysis,
  type AiCallPreview,
  type AiCallResult,
  type QuestionAiAnalysisRequest,
} from "../../shared/tauri/aiClient";
import type {
  Question,
  QuestionRegion,
} from "../../shared/tauri/questionClient";
import { captureQuestionRegionDataUrls } from "./QuestionRegionCard";
import {
  analysisPrompt,
  questionAiInputFingerprint,
} from "./QuestionAiAnalysisModel";

interface PendingPreview {
  preview: AiCallPreview;
  request: QuestionAiAnalysisRequest;
  fingerprint: string;
}

export function QuestionAiAnalysis({
  question,
  regions,
}: {
  question: Question;
  regions: QuestionRegion[];
}) {
  const [pending, setPending] = useState<PendingPreview>();
  const [result, setResult] = useState<AiCallResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const inputFingerprint = useMemo(
    () => questionAiInputFingerprint(question, regions),
    [question, regions],
  );

  useEffect(
    () => () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
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
    });
    return () => {
      cancelled = true;
    };
  }, [inputFingerprint]);

  const prepare = async () => {
    const requestId = ++requestIdRef.current;
    const capturedFingerprint = inputFingerprint;
    setBusy(true);
    setError("");
    try {
      const imageDataUrls = await captureQuestionRegionDataUrls(
        question.documentId,
        regions,
      );
      const request: QuestionAiAnalysisRequest = {
        prompt: analysisPrompt(question, imageDataUrls.length),
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
      setPending({ preview, request, fingerprint });
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
      const nextResult = await executeQuestionAiAnalysis(current.request);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setResult(nextResult);
      setPending(undefined);
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
      {result === undefined && pending === undefined ? (
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void prepare()}
        >
          {busy ? "正在准备题目图片…" : "AI 分析"}
        </button>
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
          <pre>{pending.request.prompt}</pre>
          {pending.preview.warnings.length === 0 ? null : (
            <p>
              本次调用将触及 Token 预算：{pending.preview.warnings.join(", ")}。
            </p>
          )}
          <div>
            <button
              type="button"
              disabled={busy || !pending.preview.allowed}
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
            <span>
              {result.cacheHit
                ? "已读取本地缓存 · 0 Token"
                : `本次 ${result.inputTokens + result.outputTokens} Token`}
            </span>
          </header>
          <p className="question-ai-warning">
            请自行核对结论；这不是练习册标准答案，也不会影响错题推荐算法。
          </p>
          <div className="question-ai-text">{result.responseText}</div>
          <button
            type="button"
            className="text-button"
            onClick={() => setResult(undefined)}
          >
            收起解析
          </button>
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
