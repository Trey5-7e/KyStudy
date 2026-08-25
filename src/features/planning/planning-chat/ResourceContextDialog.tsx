import { useEffect, useRef } from "react";

import type { AiAttachmentRef } from "../../../shared/tauri/aiConversationContract";
import type {
  ImportEvent,
  ResourceDocument,
} from "../../../shared/tauri/resourceClient";

interface ResourceContextDialogProps {
  open: boolean;
  busy: boolean;
  attachments: AiAttachmentRef[];
  resources: ResourceDocument[];
  resourcesLoaded: boolean;
  importEvent?: ImportEvent;
  uploadCanceling?: boolean;
  onClose(): void;
  onOpenResources(): void;
  onAttach(documentId: string): void;
  onRetryAttachment(attachmentId: string): void;
  onRemoveAttachment(attachmentId: string): void;
  onUploadComputerResource(): void;
  onCancelUpload(): void;
  onRetryUpload(): void;
}

function importProgress(event: ImportEvent): number {
  if (event.totalBytes <= 0) return 0;
  return Math.min(
    100,
    Math.round((event.copiedBytes / event.totalBytes) * 100),
  );
}

function attachmentStatusLabel(attachment: AiAttachmentRef): string {
  if (attachment.status === "ready") return "已就绪";
  if (attachment.status === "processing") return "处理中";
  if (attachment.status === "expired") return "已过期";
  return attachment.errorCode === undefined ? "处理失败" : "处理失败，可重试";
}

export function ResourceContextDialog({
  open,
  busy,
  attachments,
  resources,
  resourcesLoaded,
  importEvent,
  uploadCanceling,
  onClose,
  onOpenResources,
  onAttach,
  onRetryAttachment,
  onRemoveAttachment,
  onUploadComputerResource,
  onCancelUpload,
  onRetryUpload,
}: ResourceContextDialogProps) {
  void onUploadComputerResource;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openedRef = useRef(false);
  const attachedDocumentIds = new Set(
    attachments.map((attachment) => attachment.documentId),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (!open) {
      openedRef.current = false;
      if (dialog.open) dialog.close();
      return;
    }

    if (!openedRef.current) {
      openedRef.current = true;
      if (!dialog.open) dialog.showModal();
      if (!resourcesLoaded) {
        onOpenResources();
      }
    }
  }, [open, onOpenResources, resourcesLoaded]);

  const closeDialog = () => {
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      id="planning-chat-resources-dialog"
      className="planning-chat-resource-dialog"
      aria-labelledby="planning-chat-resource-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}
    >
      <div className="planning-chat-resource-dialog-shell">
        <header className="planning-chat-resource-dialog-header">
          <h2 id="planning-chat-resource-dialog-title">从软件资料库选择资料</h2>
          <button
            type="button"
            className="planning-chat-resource-dialog-close"
            aria-label="关闭"
            onClick={closeDialog}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              close
            </span>
          </button>
        </header>

        <div className="planning-chat-resource-dialog-body">
          <p
            style={{
              margin: "0 0 0.75rem 0",
              fontSize: "0.82rem",
              color: "var(--color-text-secondary)",
            }}
          >
            提示：如需分析电脑本地临时图片或 PDF
            文件，可直接在输入框工具栏点击“电脑文件”或拖拽/粘贴文件，无需提前存入资料库。
          </p>

          {importEvent === undefined ? null : (
            <section
              className={`planning-chat-resource-import-status planning-chat-resource-import-${importEvent.state}`}
              aria-live="polite"
            >
              <div className="planning-chat-resource-import-heading">
                <strong>
                  {importEvent.state === "running"
                    ? `正在导入电脑资料 ${importProgress(importEvent)}%`
                    : importEvent.state === "succeeded"
                      ? "电脑资料已导入"
                      : importEvent.state === "canceled"
                        ? "电脑资料导入已取消"
                        : "电脑资料导入失败"}
                </strong>
                {importEvent.state === "running" ? (
                  <button
                    type="button"
                    className="text-button"
                    disabled={uploadCanceling}
                    onClick={onCancelUpload}
                  >
                    取消
                  </button>
                ) : null}
              </div>
              {importEvent.state === "running" ? (
                <progress
                  max={100}
                  value={importProgress(importEvent)}
                  aria-label="资料导入进度"
                />
              ) : null}
              {importEvent.error === undefined ? null : (
                <small>{importEvent.error.message}</small>
              )}
              {importEvent.state === "failed" ||
              importEvent.state === "canceled" ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={onRetryUpload}
                >
                  重新选择资料
                </button>
              ) : null}
            </section>
          )}

          <section
            className="planning-chat-resource-selection"
            aria-label="软件本地资料"
          >
            {resourcesLoaded && resources.length > 0 ? (
              <ul className="planning-chat-resource-list">
                {resources.map((resource) => {
                  const attached = attachedDocumentIds.has(resource.id);
                  const disabled = busy || attached || attachments.length >= 6;
                  return (
                    <li key={resource.id}>
                      <button
                        type="button"
                        className="planning-chat-resource-option"
                        disabled={disabled}
                        onClick={() => onAttach(resource.id)}
                      >
                        <span>
                          <strong>{resource.title}</strong>
                        </span>
                        <span>{attached ? "已添加" : "添加"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          {attachments.length === 0 ? null : (
            <ul
              className="planning-chat-selected-resources"
              aria-label="已添加资料"
            >
              {attachments.map((attachment) => (
                <li key={attachment.id}>
                  <span className="planning-chat-selected-resource-copy">
                    <strong>{attachment.fileName}</strong>
                    <small>{attachmentStatusLabel(attachment)}</small>
                  </span>
                  <span className="planning-chat-selected-resource-actions">
                    {attachment.source === "resource" &&
                    attachment.documentId !== undefined &&
                    (attachment.status === "expired" ||
                      attachment.status === "failed") ? (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => onRetryAttachment(attachment.id)}
                      >
                        重试
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="planning-chat-resource-remove"
                      aria-label={`移除 ${attachment.fileName}`}
                      disabled={busy}
                      onClick={() => onRemoveAttachment(attachment.id)}
                    >
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        close
                      </span>
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </dialog>
  );
}
