import { useEffect, useRef, useState } from "react";

import {
  cancelOcr,
  confirmQuestionRegionOcr,
  discardQuestionRegionOcr,
  getOcrStatus,
  installOcrComponent,
  listQuestionOcr,
  normalizeOcrError,
  recognizeQuestionRegion,
  removeOcrComponent,
  type OcrComponentStatus,
  type OcrRecognition,
} from "../../shared/tauri/ocrClient";
import type { QuestionRegion } from "../../shared/tauri/questionClient";
import type { ResourceCommandError } from "../../shared/tauri/resourceClient";

interface QuestionOcrPanelProps {
  questionId: string;
  regions: QuestionRegion[];
  captureRegion(region: QuestionRegion): Promise<Uint8Array>;
}

interface ActiveRecognition {
  operationId: string;
  regionId: string;
  cancelRequested: boolean;
}

export function QuestionOcrPanel({
  questionId,
  regions,
  captureRegion,
}: QuestionOcrPanelProps) {
  const [component, setComponent] = useState<OcrComponentStatus>();
  const [recognitions, setRecognitions] = useState<OcrRecognition[]>([]);
  const [active, setActive] = useState<ActiveRecognition>();
  const [mutatingId, setMutatingId] = useState<string>();
  const [componentBusy, setComponentBusy] = useState<"install" | "remove">();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ResourceCommandError>();
  const locallyCanceled = useRef(new Set<string>());

  useEffect(() => {
    let mounted = true;
    void Promise.all([getOcrStatus(), listQuestionOcr(questionId)]).then(
      ([status, loaded]) => {
        if (mounted) {
          setComponent(status);
          setRecognitions(loaded);
          setLoading(false);
        }
      },
      (loadError: unknown) => {
        if (mounted) {
          setError(normalizeOcrError(loadError));
          setLoading(false);
        }
      },
    );
    return () => {
      mounted = false;
    };
  }, [questionId]);

  const reload = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [status, loaded] = await Promise.all([
        getOcrStatus(),
        listQuestionOcr(questionId),
      ]);
      setComponent(status);
      setRecognitions(loaded);
    } catch (reloadError: unknown) {
      setError(normalizeOcrError(reloadError));
    } finally {
      setLoading(false);
    }
  };

  const manageComponent = async (action: "install" | "remove") => {
    if (
      componentBusy !== undefined ||
      active !== undefined ||
      mutatingId !== undefined
    ) {
      return;
    }
    if (
      action === "remove" &&
      !window.confirm("移除本地 OCR 组件？PDF 阅读和手动框选不会受影响。")
    ) {
      return;
    }
    setComponentBusy(action);
    setError(undefined);
    try {
      const next =
        action === "install"
          ? await installOcrComponent()
          : await removeOcrComponent();
      if (next !== null) {
        setComponent(next);
      }
    } catch (componentError: unknown) {
      setError(normalizeOcrError(componentError));
    } finally {
      setComponentBusy(undefined);
    }
  };

  const recognize = async (region: QuestionRegion) => {
    const operationId = crypto.randomUUID();
    setActive({ operationId, regionId: region.id, cancelRequested: false });
    setError(undefined);
    try {
      const imageBytes = await captureRegion(region);
      if (locallyCanceled.current.has(operationId)) {
        return;
      }
      await recognizeQuestionRegion(operationId, region, imageBytes);
      setRecognitions(await listQuestionOcr(questionId));
    } catch (recognitionError: unknown) {
      setError(normalizeOcrError(recognitionError));
    } finally {
      locallyCanceled.current.delete(operationId);
      setActive((current) =>
        current?.operationId === operationId ? undefined : current,
      );
    }
  };

  const requestCancel = async () => {
    if (active === undefined || active.cancelRequested) {
      return;
    }
    const operationId = active.operationId;
    locallyCanceled.current.add(operationId);
    setActive((current) =>
      current?.operationId === operationId
        ? { ...current, cancelRequested: true }
        : current,
    );
    try {
      await cancelOcr(operationId);
    } catch (cancelError: unknown) {
      setError(normalizeOcrError(cancelError));
    }
  };

  const confirm = async (recognitionId: string, text: string) => {
    setMutatingId(recognitionId);
    setError(undefined);
    try {
      await confirmQuestionRegionOcr(recognitionId, text);
      setRecognitions(await listQuestionOcr(questionId));
    } catch (confirmError: unknown) {
      setError(normalizeOcrError(confirmError));
    } finally {
      setMutatingId(undefined);
    }
  };

  const discard = async (recognitionId: string) => {
    setMutatingId(recognitionId);
    setError(undefined);
    try {
      await discardQuestionRegionOcr(recognitionId);
      setRecognitions(await listQuestionOcr(questionId));
    } catch (discardError: unknown) {
      setError(normalizeOcrError(discardError));
    } finally {
      setMutatingId(undefined);
    }
  };

  return (
    <section className="question-ocr" aria-labelledby="question-ocr-title">
      <div className="question-ocr-heading">
        <div>
          <h4 id="question-ocr-title">本地文字识别</h4>
          <p>{componentStatusLabel(component, loading)}</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={
            loading ||
            componentBusy !== undefined ||
            active !== undefined ||
            mutatingId !== undefined
          }
          onClick={() => void reload()}
        >
          重新检测
        </button>
        {component?.state === "available" ? (
          <>
            <button
              type="button"
              className="secondary-button"
              disabled={
                loading || componentBusy !== undefined || active !== undefined
              }
              onClick={() => void manageComponent("install")}
            >
              {componentBusy === "install" ? "正在修复" : "修复组件"}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={
                loading || componentBusy !== undefined || active !== undefined
              }
              onClick={() => void manageComponent("remove")}
            >
              {componentBusy === "remove" ? "正在移除" : "移除组件"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="secondary-button"
            disabled={
              loading || componentBusy !== undefined || active !== undefined
            }
            onClick={() => void manageComponent("install")}
          >
            {componentBusy === "install" ? "正在安装" : "安装 OCR 组件"}
          </button>
        )}
      </div>

      {error === undefined ? null : (
        <div className="error-detail" role="alert">
          <strong>{error.message}</strong>
          <p>{error.action}</p>
        </div>
      )}

      {regions.map((region) => {
        const current = recognitions.filter(
          (recognition) => recognition.regionId === region.id,
        );
        const draft = current.find(
          (recognition) => recognition.state === "draft",
        );
        const confirmed = current.find(
          (recognition) => recognition.state === "confirmed",
        );
        const isActive = active?.regionId === region.id;
        return (
          <article className="question-ocr-region" key={region.id}>
            <div className="question-ocr-region-heading">
              <strong>
                第 {region.pageNumber} 页 · 区域 {region.sortOrder + 1}
              </strong>
              {isActive ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={active.cancelRequested}
                  onClick={() => void requestCancel()}
                >
                  {active.cancelRequested ? "正在取消" : "取消识别"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={
                    component?.state !== "available" ||
                    componentBusy !== undefined ||
                    active !== undefined ||
                    mutatingId !== undefined
                  }
                  onClick={() => void recognize(region)}
                >
                  {draft === undefined && confirmed === undefined
                    ? "识别区域"
                    : "重新识别"}
                </button>
              )}
            </div>

            {confirmed === undefined ? null : (
              <div className="question-ocr-confirmed">
                <span>已确认文本</span>
                <p>{confirmed.confirmedText}</p>
              </div>
            )}

            {draft === undefined ? (
              confirmed === undefined && !isActive ? (
                <p className="empty-state">暂无识别文本。</p>
              ) : null
            ) : (
              <OcrDraftEditor
                key={draft.id}
                draft={draft}
                busy={mutatingId === draft.id || active !== undefined}
                onConfirm={confirm}
                onDiscard={discard}
              />
            )}
          </article>
        );
      })}

      <p className="question-ocr-note">
        公式、矩阵和复杂表格请以原始题目区域为准。
      </p>
    </section>
  );
}

interface OcrDraftEditorProps {
  draft: OcrRecognition;
  busy: boolean;
  onConfirm(recognitionId: string, text: string): Promise<void>;
  onDiscard(recognitionId: string): Promise<void>;
}

function OcrDraftEditor({
  draft,
  busy,
  onConfirm,
  onDiscard,
}: OcrDraftEditorProps) {
  const [text, setText] = useState(draft.recognizedText);
  return (
    <div className="question-ocr-draft">
      <label>
        待确认草稿 · 平均置信度 {Math.round(draft.meanConfidence * 100)}%
        <textarea
          rows={6}
          maxLength={100_000}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="question-form-actions">
        <button
          type="button"
          disabled={busy || text.trim() === ""}
          onClick={() => void onConfirm(draft.id, text)}
        >
          确认文本
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void onDiscard(draft.id)}
        >
          丢弃草稿
        </button>
      </div>
    </div>
  );
}

function componentStatusLabel(
  component: OcrComponentStatus | undefined,
  loading: boolean,
): string {
  if (loading) {
    return "正在检测 OCR 组件…";
  }
  if (component === undefined || component.state === "missing") {
    return "OCR 组件未安装 · 可选离线组件";
  }
  if (component.state === "incomplete") {
    return `OCR 组件不完整 · ${component.engine}`;
  }
  const size = component.componentSizeBytes;
  return size === undefined
    ? `OCR 组件可用 · ${component.engine} · 完全离线`
    : `OCR 组件可用 · ${component.engine} · 完全离线 · ${formatBytes(size)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
