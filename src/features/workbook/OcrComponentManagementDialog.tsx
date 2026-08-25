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
  const [selectedVersion, setSelectedVersion] = useState<string>("v0.1.4");
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
      if (info.defaultVersion) setSelectedVersion(info.defaultVersion);
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
          if (info.defaultVersion) setSelectedVersion(info.defaultVersion);
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
      setComponent(await downloadOcrComponent(operationId, selectedVersion));
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
        {downloadInfo?.available === true &&
        downloadInfo.versions &&
        downloadInfo.versions.length > 0 ? (
          <div
            style={{
              marginTop: "16px",
              marginBottom: "12px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <label
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--color-text-primary, #17231d)",
              }}
            >
              选择在线下载版本：
            </label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "10px",
              }}
            >
              {downloadInfo.versions.map((pkg) => {
                const isSelected = selectedVersion === pkg.versionId;
                return (
                  <button
                    type="button"
                    key={pkg.versionId}
                    onClick={() => {
                      if (busy === undefined) setSelectedVersion(pkg.versionId);
                    }}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: "var(--radius-sm, 8px)",
                      border: `1.5px solid ${
                        isSelected
                          ? "var(--color-primary, #1e5b42)"
                          : "var(--color-border-default, #d1d5db)"
                      }`,
                      background: isSelected
                        ? "var(--color-bg-subtle, #edf3ed)"
                        : "var(--color-bg-surface, #ffffff)",
                      cursor: busy === undefined ? "pointer" : "default",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        width: "100%",
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "13px",
                          color: "var(--color-text-primary, #17231d)",
                        }}
                      >
                        {pkg.versionId} {pkg.label}
                      </span>
                      {pkg.isRecommended ? (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "1px 6px",
                            borderRadius: "4px",
                            background: "var(--color-primary-soft, #dce9df)",
                            color: "var(--color-primary, #1e5b42)",
                          }}
                        >
                          推荐
                        </span>
                      ) : null}
                    </div>
                    <span
                      style={{
                        fontSize: "12px",
                        color: "var(--color-text-secondary, #52625a)",
                        lineHeight: "1.4",
                      }}
                    >
                      {pkg.description}
                    </span>
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--color-text-muted, #657269)",
                        marginTop: "2px",
                      }}
                    >
                      下载 {formatBytes(pkg.downloadSizeBytes)} · 解压{" "}
                      {formatBytes(pkg.installedSizeBytes)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
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
            {busy === "download"
              ? `正在下载 (${selectedVersion})`
              : `在线下载 OCR 组件 (${selectedVersion})`}
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
