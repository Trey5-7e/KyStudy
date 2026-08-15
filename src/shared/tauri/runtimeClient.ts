import { invoke } from "@tauri-apps/api/core";

export interface RuntimeStatus {
  appVersion: string;
  schemaVersion: number;
  platform: string;
  architecture: string;
  buildProfile: "debug" | "release";
}

export interface AppError {
  code: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseRuntimeStatus(value: unknown): RuntimeStatus {
  if (
    !isRecord(value) ||
    typeof value.appVersion !== "string" ||
    typeof value.schemaVersion !== "number" ||
    !Number.isSafeInteger(value.schemaVersion) ||
    value.schemaVersion < 0 ||
    typeof value.platform !== "string" ||
    typeof value.architecture !== "string" ||
    (value.buildProfile !== "debug" && value.buildProfile !== "release")
  ) {
    throw new Error("RUNTIME_STATUS_INVALID");
  }

  return {
    appVersion: value.appVersion,
    schemaVersion: value.schemaVersion,
    platform: value.platform,
    architecture: value.architecture,
    buildProfile: value.buildProfile,
  };
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const value: unknown = await invoke("get_runtime_status");
  return parseRuntimeStatus(value);
}

export function normalizeCommandError(error: unknown): AppError {
  if (error instanceof Error && error.message === "RUNTIME_STATUS_INVALID") {
    return {
      code: "RUNTIME_STATUS_INVALID",
      message: "本地核心返回了无法识别的状态，请重新启动应用。",
    };
  }

  return {
    code: "LOCAL_CORE_UNAVAILABLE",
    message: "暂时无法连接本地核心。请在 KyStudy 桌面应用中重试。",
  };
}
