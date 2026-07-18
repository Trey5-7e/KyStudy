import { invoke } from "@tauri-apps/api/core";

export interface BackupReport {
  directoryName: string;
  blobCount: number;
  totalBytes: number;
  createdAt: number;
}

export interface RestoreReport {
  directoryName: string;
  blobCount: number;
  totalBytes: number;
}

export interface BackupCommandError {
  code: string;
  message: string;
  action: string;
  operationId?: string;
}

const ERROR_COPY: Record<string, { message: string; action: string }> = {
  WORKSPACE_NOT_INITIALIZED: {
    message: "尚未创建可备份的本地工作区。",
    action: "先创建工作区，再创建完整备份。",
  },
  BACKUP_SOURCE_NOT_DIRECTORY: {
    message: "所选位置不是可用的本地文件夹。",
    action: "重新选择备份文件夹或目标父文件夹。",
  },
  BACKUP_DESTINATION_INSIDE_WORKSPACE: {
    message: "备份不能保存在 KyStudy 管理的工作区内部。",
    action: "请选择工作区之外的文件夹。",
  },
  BACKUP_VERSION_UNSUPPORTED: {
    message: "该备份版本不受当前 KyStudy 支持。",
    action: "使用创建该备份的兼容版本进行恢复。",
  },
  BACKUP_MANIFEST_INVALID: {
    message: "备份清单与数据库记录不一致。",
    action: "不要修改备份目录；请重新选择一份完整备份。",
  },
  MANAGED_PATH_INVALID: {
    message: "备份包含不安全的内部路径。",
    action: "不要使用该备份恢复；请重新创建备份。",
  },
  FILE_INTEGRITY_MISMATCH: {
    message: "备份中的文件完整性校验未通过。",
    action: "不要使用该备份恢复；请保留它以便诊断。",
  },
  DESTINATION_EXISTS: {
    message: "目标目录已经存在，KyStudy 不会覆盖它。",
    action: "重新选择目标父文件夹后再试。",
  },
  DISK_SPACE_INSUFFICIENT: {
    message: "目标磁盘空间不足，无法安全完成操作。",
    action: "释放目标磁盘空间后重试。",
  },
  FILE_OPERATION_FAILED: {
    message: "无法读取备份或写入目标文件夹。",
    action: "检查文件占用、磁盘空间和目录权限后重试。",
  },
  MANIFEST_SERIALIZATION_FAILED: {
    message: "备份清单无法读取。",
    action: "重新选择未被修改的 KyStudy 备份目录。",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseBackupReport(value: unknown): BackupReport {
  if (
    !isRecord(value) ||
    typeof value.directoryName !== "string" ||
    value.directoryName.length === 0 ||
    value.directoryName.includes("/") ||
    value.directoryName.includes("\\") ||
    !isSafeNonNegativeInteger(value.blobCount) ||
    !isSafeNonNegativeInteger(value.totalBytes) ||
    !isSafeNonNegativeInteger(value.createdAt)
  ) {
    throw new Error("BACKUP_REPORT_INVALID");
  }
  return {
    directoryName: value.directoryName,
    blobCount: value.blobCount,
    totalBytes: value.totalBytes,
    createdAt: value.createdAt,
  };
}

export function parseRestoreReport(value: unknown): RestoreReport {
  if (
    !isRecord(value) ||
    typeof value.directoryName !== "string" ||
    value.directoryName.length === 0 ||
    value.directoryName.includes("/") ||
    value.directoryName.includes("\\") ||
    !isSafeNonNegativeInteger(value.blobCount) ||
    !isSafeNonNegativeInteger(value.totalBytes)
  ) {
    throw new Error("RESTORE_REPORT_INVALID");
  }
  return {
    directoryName: value.directoryName,
    blobCount: value.blobCount,
    totalBytes: value.totalBytes,
  };
}

export async function createWorkspaceBackup(): Promise<BackupReport | null> {
  const value: unknown = await invoke("create_workspace_backup");
  return value === null ? null : parseBackupReport(value);
}

export async function restoreWorkspaceBackup(): Promise<RestoreReport | null> {
  const value: unknown = await invoke("restore_workspace_backup");
  return value === null ? null : parseRestoreReport(value);
}

export function normalizeBackupCommandError(
  error: unknown,
): BackupCommandError {
  if (isRecord(error) && typeof error.code === "string") {
    const copy = ERROR_COPY[error.code];
    if (copy !== undefined) {
      return {
        code: error.code,
        ...copy,
        operationId:
          typeof error.operationId === "string" ? error.operationId : undefined,
      };
    }
  }
  return {
    code: "BACKUP_UNAVAILABLE",
    message: "本地备份功能暂时无法使用。",
    action: "重新启动应用后重试。",
  };
}
