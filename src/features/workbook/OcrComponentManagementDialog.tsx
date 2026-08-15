import { useEffect, useState } from "react";

import { EditorDialog } from "../../shared/components/EditorDialog";
import {
  cancelOcr,
  downloadOcrComponent,
  getOcrDownloadInfo,
  getOcrStatus,
  installOcrComponent,
  listenToOcrDownloadEvents,
  normalizeOcrError,
  removeOcrComponent,
  type OcrComponentStatus,
  type OcrComponentDownloadInfo,
} from "../../shared/tauri/ocrClient";
import type { ResourceCommandError } from "../../shared/tauri/resourceClient";

export function OcrComponentManagementDialog({
  onClose,
  onRequestBack,
  backLabel,
}: {
  onClose(): void;
  onRequestBack?(): void;
  backLabel?: string;
}) {
  const [component, setComponent] = useState<OcrComponentStatus>();
  const [downloadInfo, setDownloadInfo] = useState<OcrComponentDownloadInfo>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"install" | "remove" | "download">();
  const [downloadProgress, setDownloadProgress] = useState<{
    copiedBytes: number;
    totalBytes: number;
  }>();
  const [downloadOperationId, setDownloadOperationId] = useState<string>();
  const [error, setError] = useState<ResourceCommandError>();

  const reload = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [status, info] = await Promise.all([
        getOcrStatus(),
        getOcrDownloadInfo(),
      ]);
      setComponent(status);
      setDownloadInfo(info);
    } catch (loadError: unknown) {
      setError(normalizeOcrError(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void Promise.all([getOcrStatus(), getOcrDownloadInfo()]).then(
      ([status, info]) => {
        if (active) {
          setComponent(status);
          setDownloadInfo(info);
          setLoading(false);
        }
      },
      (loadError: unknown) => {
        if (active) {
          setError(normalizeOcrError(loadError));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const manage = async (action: "install" | "remove") => {
    if (busy !== undefined || loading) return;
    if (
      action === "remove" &&
      !window.confirm("移除本地 OCR 组件？PDF 阅读和手动框选不会受影响。")
    ) {
      return;
    }
    setBusy(action);
    setError(undefined);
    try {
      const next =
        action === "install"
          ? await installOcrComponent()
          : await removeOcrComponent();
      if (next !== null) setComponent(next);
    } catch (manageError: unknown) {
      setError(normalizeOcrError(manageError));
    } finally {
      setBusy(undefined);
    }
  };

  const download = async () => {
    if (busy !== undefined || loading || downloadInfo?.available !== true) {
      return;
    }
    const operationId = crypto.randomUUID();
    setBusy("download");
    setDownloadOperationId(operationId);
    setDownloadProgress({ copiedBytes: 0, totalBytes: 0 });
    setError(undefined);
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listenToOcrDownloadEvents((event) => {
        if (event.operationId !== operationId) return;
        setDownloadProgress({
          copiedBytes: event.copiedBytes,
          totalBytes: event.totalBytes,
        });
        if (event.error !== undefined) setError(event.error);
      });
      setComponent(await downloadOcrComponent(operationId));
    } catch (downloadError: unknown) {
      setError(normalizeOcrError(downloadError));
    } finally {
      await unlisten?.();
      setBusy(undefined);
      setDownloadOperationId(undefined);
      setDownloadProgress(undefined);
    }
  };

  const available = component?.state === "available";
  const actionLabel = available
    ? busy === "install"
      ? "正在修复"
      : "修复组件"
    : busy === "install"
      ? "正在安装"
      : "安装 OCR 组件";

  return (
    <EditorDialog
      title="OCR 组件管理"
      description="OCR 是可选的离线组件，不影响 PDF 阅读、题目索引和手动录入。"
      dirty={false}
      onRequestClose={onClose}
      onRequestBack={onRequestBack}
      backLabel={backLabel}
      closeDisabled={busy !== undefined}
      size="medium"
    >
      <section className="ocr-component-management" aria-live="polite">
        <h3>本地文字识别</h3>
        <p className="form-hint">{componentStatusLabel(component, loading)}</p>
        {error === undefined ? null : (
          <div className="form-error" role="alert">
            <strong>{error.message}</strong>
            <span>{error.action}</span>
          </div>
        )}
        <div className="question-form-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={loading || busy !== undefined}
            onClick={() => void reload()}
          >
            重新检测
          </button>
          <button
            type="button"
            disabled={loading || busy !== undefined}
            onClick={() => void manage("install")}
          >
            {actionLabel}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={
              loading || busy !== undefined || downloadInfo?.available !== true
            }
            onClick={() => void download()}
          >
            {busy === "download" ? "正在下载" : "在线下载 OCR 组件"}
          </button>
          {busy === "download" ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                if (downloadOperationId !== undefined) {
                  void cancelOcr(downloadOperationId);
                }
              }}
            >
              取消
            </button>
          ) : null}
          {available ? (
            <button
              type="button"
              className="danger-button"
              disabled={loading || busy !== undefined}
              onClick={() => void manage("remove")}
            >
              {busy === "remove" ? "正在移除" : "移除组件"}
            </button>
          ) : null}
        </div>
        {downloadInfo?.available !== true ? (
          <p className="form-hint">
            在线下载资产尚未发布；当前可使用本地安装，发布后会自动启用在线下载。
          </p>
        ) : null}
        {downloadProgress !== undefined && downloadProgress.totalBytes > 0 ? (
          <p className="form-hint">
            下载进度：{formatBytes(downloadProgress.copiedBytes)} /{" "}
            {formatBytes(downloadProgress.totalBytes)}
          </p>
        ) : null}
      </section>
    </EditorDialog>
  );
}

function componentStatusLabel(
  component: OcrComponentStatus | undefined,
  loading: boolean,
): string {
  if (loading) return "正在检测 OCR 组件…";
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
  if (bytes < 1024 * 1024)
    return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
