import { invoke } from "@tauri-apps/api/core";

export interface WorkspaceStatus {
  id: string;
  name: string;
  timezone: string;
  dailyReviewQuota: number;
  earlyFillEnabled: boolean;
  createdAt: number;
  schemaVersion: number;
}

export interface WorkspaceCommandError {
  code: string;
  message: string;
  action: string;
  operationId?: string;
}

const ERROR_COPY: Record<string, { message: string; action: string }> = {
  DATABASE_BUSY: {
    message: "本地数据库正在被占用，请稍后重试。",
    action: "关闭其他 KyStudy 窗口后重试。",
  },
  WORKSPACE_STORAGE_UNAVAILABLE: {
    message: "无法访问本地工作区存储。",
    action: "检查磁盘空间和目录权限后重试。",
  },
  DATABASE_CONFIGURATION_UNSUPPORTED: {
    message: "本地数据库配置不符合 KyStudy 的安全要求。",
    action: "不要覆盖文件；请保留工作区并查看诊断信息。",
  },
  DATABASE_ERROR: {
    message: "本地工作区暂时无法打开。",
    action: "重新启动应用；如果仍失败，请导出诊断信息。",
  },
  SCHEMA_VERSION_UNSUPPORTED: {
    message: "这个工作区由更新版本的 KyStudy 创建，当前版本无法安全打开。",
    action: "请升级 KyStudy 后重试。",
  },
  MIGRATION_HISTORY_INCONSISTENT: {
    message: "工作区数据库升级记录不一致。",
    action: "不要覆盖文件；请保留工作区并查看诊断信息。",
  },
  MIGRATION_FAILED: {
    message: "工作区数据库升级未能安全完成。",
    action: "不要覆盖文件；请保留工作区并查看诊断信息。",
  },
  SYSTEM_TIME_INVALID: {
    message: "系统时间无法用于创建工作区。",
    action: "检查 Windows 日期和时间设置后重试。",
  },
  INTERNAL_ERROR: {
    message: "本地任务意外中断。",
    action: "重新启动应用后重试。",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseWorkspaceStatus(value: unknown): WorkspaceStatus | null {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.timezone !== "string" ||
    typeof value.dailyReviewQuota !== "number" ||
    !Number.isSafeInteger(value.dailyReviewQuota) ||
    value.dailyReviewQuota < 1 ||
    typeof value.earlyFillEnabled !== "boolean" ||
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    typeof value.schemaVersion !== "number" ||
    !Number.isSafeInteger(value.schemaVersion) ||
    value.schemaVersion < 1
  ) {
    throw new Error("WORKSPACE_STATUS_INVALID");
  }

  return {
    id: value.id,
    name: value.name,
    timezone: value.timezone,
    dailyReviewQuota: value.dailyReviewQuota,
    earlyFillEnabled: value.earlyFillEnabled,
    createdAt: value.createdAt,
    schemaVersion: value.schemaVersion,
  };
}

export async function getWorkspaceStatus(): Promise<WorkspaceStatus | null> {
  const value: unknown = await invoke("get_workspace_status");
  return parseWorkspaceStatus(value);
}

export async function initializeDefaultWorkspace(): Promise<WorkspaceStatus> {
  const value: unknown = await invoke("initialize_default_workspace");
  const workspace = parseWorkspaceStatus(value);
  if (workspace === null) {
    throw new Error("WORKSPACE_STATUS_INVALID");
  }
  return workspace;
}

export function normalizeWorkspaceCommandError(
  error: unknown,
): WorkspaceCommandError {
  if (error instanceof Error && error.message === "WORKSPACE_STATUS_INVALID") {
    return {
      code: "WORKSPACE_STATUS_INVALID",
      message: "本地核心返回了无法识别的工作区状态。",
      action: "重新启动应用后重试。",
    };
  }

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
    code: "WORKSPACE_UNAVAILABLE",
    message: "本地工作区暂时无法打开。",
    action: "重新启动应用后重试。",
  };
}
