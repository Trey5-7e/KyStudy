import type { RefObject } from "react";

import { EditorDialog } from "../../../shared/components/EditorDialog";
import type { PlanningChatPreview } from "../../../shared/tauri/planningChatClient";

interface PreviewDialogProps {
  preview?: PlanningChatPreview;
  contextCount: number;
  confirmed: boolean;
  busy: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onConfirmed(value: boolean): void;
  onExecute(): void;
  onClose(): void;
  onOpenReference(documentId: string, page: number): void;
}

export function PreviewDialog({
  preview,
  contextCount,
  confirmed,
  busy,
  headingRef,
  returnFocusRef,
  onConfirmed,
  onExecute,
  onClose,
  onOpenReference,
}: PreviewDialogProps) {
  if (preview === undefined) return null;

  return (
    <EditorDialog
      title="确认 AI 外发请求"
      description="只有下方展示的完整文本会在明确确认后发送。"
      dirty={false}
      onRequestClose={onClose}
      closeDisabled={busy}
      size="large"
      initialFocusRef={headingRef}
      returnFocusRef={returnFocusRef}
    >
      <section
        className="planning-chat-preview"
        aria-labelledby="planning-preview-title"
      >
        <h3 ref={headingRef} id="planning-preview-title" tabIndex={-1}>
          完整请求预览
        </h3>
        <dl className="planning-preview-summary">
          <div>
            <dt>目标</dt>
            <dd>{preview.preview.destination}</dd>
          </div>
          <div>
            <dt>预计 Token</dt>
            <dd>{preview.preview.projectedTokens}</dd>
          </div>
          <div>
            <dt>上下文页</dt>
            <dd>{contextCount}</dd>
          </div>
          <div>
            <dt>来源</dt>
            <dd>{preview.sources.length}</dd>
          </div>
        </dl>
        <p className="planning-preview-budget">
          输入估算 {preview.preview.inputTokenEstimate}；输出上限{" "}
          {preview.preview.outputTokenLimit}；今日已用{" "}
          {preview.preview.todayTokens}；本月已用 {preview.preview.monthTokens}
          。
        </p>
        {preview.sources.length === 0 ? null : (
          <div className="planning-preview-sources" aria-label="引用来源">
            {preview.sources.map((source) => (
              <button
                key={`${source.documentId}:${source.pageNumber}`}
                type="button"
                className="secondary-button"
                onClick={() => {
                  onClose();
                  requestAnimationFrame(() =>
                    onOpenReference(source.documentId, source.pageNumber),
                  );
                }}
              >
                {source.citationLabel} {source.documentTitle} · 第
                {source.pageNumber} 页
              </button>
            ))}
          </div>
        )}
        <pre data-confirmed-prompt="true">{preview.preview.prompt}</pre>
        {preview.preview.warnings.length === 0 ? null : (
          <ul className="planning-preview-warnings">
            {preview.preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
        <label className="ai-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!preview.preview.allowed || busy}
            onChange={(event) => onConfirmed(event.target.checked)}
          />
          我已核对完整外发文本和所选来源。
        </label>
        <button
          type="button"
          disabled={!confirmed || !preview.preview.allowed || busy}
          onClick={onExecute}
        >
          确认并发送
        </button>
      </section>
    </EditorDialog>
  );
}
