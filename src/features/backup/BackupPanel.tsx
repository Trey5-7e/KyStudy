import { useState } from "react";

import {
  createWorkspaceBackup,
  normalizeBackupCommandError,
  restoreWorkspaceBackup,
  type BackupCommandError,
  type BackupReport,
  type RestoreReport,
} from "../../shared/tauri/backupClient";

type BackupState =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "restoring" }
  | { kind: "backup-ready"; report: BackupReport }
  | { kind: "restore-ready"; report: RestoreReport }
  | { kind: "error"; error: BackupCommandError };

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KiB`;
  }
  if (sizeBytes < 1024 * 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

export function BackupPanel() {
  const [state, setState] = useState<BackupState>({ kind: "idle" });
  const busy = state.kind === "creating" || state.kind === "restoring";

  const createBackup = async () => {
    setState({ kind: "creating" });
    try {
      const report = await createWorkspaceBackup();
      setState(
        report === null ? { kind: "idle" } : { kind: "backup-ready", report },
      );
    } catch (error: unknown) {
      setState({ kind: "error", error: normalizeBackupCommandError(error) });
    }
  };

  const restoreBackup = async () => {
    setState({ kind: "restoring" });
    try {
      const report = await restoreWorkspaceBackup();
      setState(
        report === null ? { kind: "idle" } : { kind: "restore-ready", report },
      );
    } catch (error: unknown) {
      setState({ kind: "error", error: normalizeBackupCommandError(error) });
    }
  };

  return (
    <section className="backup-card" aria-labelledby="backup-title">
      <div className="backup-heading">
        <div>
          <p className="section-label">完整本地备份</p>
          <h2 id="backup-title">备份与恢复副本</h2>
          <p className="backup-description">
            备份包含 SQLite 一致快照、正式资料和校验清单，不包含临时文件或密钥。
          </p>
        </div>
        <div className="backup-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => void createBackup()}
          >
            创建完整备份
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void restoreBackup()}
          >
            验证并生成恢复副本
          </button>
        </div>
      </div>

      {state.kind === "creating" ? (
        <p className="backup-status" aria-live="polite">
          正在创建并校验完整备份，请不要关闭应用…
        </p>
      ) : null}
      {state.kind === "restoring" ? (
        <p className="backup-status" aria-live="polite">
          正在校验备份并生成独立恢复副本，请不要关闭应用…
        </p>
      ) : null}
      {state.kind === "backup-ready" ? (
        <div className="success-detail" role="status">
          <strong>完整备份已创建并通过校验</strong>
          <p>
            目录：{state.report.directoryName} · {state.report.blobCount} 个
            Blob · {formatBytes(state.report.totalBytes)}
          </p>
        </div>
      ) : null}
      {state.kind === "restore-ready" ? (
        <div className="success-detail" role="status">
          <strong>恢复副本已创建并通过校验</strong>
          <p>
            目录：{state.report.directoryName} · {state.report.blobCount} 个
            Blob · {formatBytes(state.report.totalBytes)}
          </p>
          <p>当前工作区没有被替换。</p>
        </div>
      ) : null}
      {state.kind === "error" ? (
        <div className="error-detail" role="alert">
          <strong>{state.error.message}</strong>
          <p>{state.error.action}</p>
          {state.error.operationId === undefined ? null : (
            <p className="operation-id">操作编号：{state.error.operationId}</p>
          )}
        </div>
      ) : null}

      <p className="backup-note">
        M1-012 的恢复不会覆盖当前工作区，而是在所选位置创建经过验证的独立副本。
      </p>
    </section>
  );
}
