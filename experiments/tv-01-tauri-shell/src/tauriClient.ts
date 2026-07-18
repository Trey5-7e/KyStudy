import { invoke, isTauri } from "@tauri-apps/api/core";

export interface EnvironmentStatus {
  appVersion: string;
  platform: string;
  arch: string;
  appDataReady: boolean;
  operationId: string;
}

export interface AppError {
  code: string;
  message: string;
  action?: string | null;
  operationId: string;
}

export interface FileFingerprint {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  operationId: string;
}

export interface OperationStarted {
  operationId: string;
}

export interface ProgressEvent {
  operationId: string;
  percent: number;
  stage: string;
  done: boolean;
  cancelled: boolean;
}

export const isDesktopRuntime = (): boolean => isTauri();

export const getEnvironmentStatus = (): Promise<EnvironmentStatus> =>
  invoke<EnvironmentStatus>("get_environment_status");

export const triggerExpectedFailure = (): Promise<void> =>
  invoke<void>("trigger_expected_failure");

export const probeUntrustedPath = (candidatePath: string): Promise<void> =>
  invoke<void>("probe_untrusted_path", { candidatePath });

export const selectFileFingerprint = (): Promise<FileFingerprint> =>
  invoke<FileFingerprint>("select_file_fingerprint");

export const startProgressDemo = (): Promise<OperationStarted> =>
  invoke<OperationStarted>("start_progress_demo");

export const cancelProgressDemo = (operationId: string): Promise<void> =>
  invoke<void>("cancel_progress_demo", { operationId });

export function normalizeAppError(error: unknown): AppError {
  if (typeof error === "object" && error !== null) {
    const candidate = error as Partial<AppError>;
    if (
      typeof candidate.code === "string" &&
      typeof candidate.message === "string" &&
      typeof candidate.operationId === "string"
    ) {
      return {
        code: candidate.code,
        message: candidate.message,
        action: candidate.action,
        operationId: candidate.operationId,
      };
    }
  }

  return {
    code: "UNEXPECTED_CLIENT_ERROR",
    message: "前端未能识别本次错误。",
    action: "请记录当前操作并查看本地诊断日志。",
    operationId: "client-unavailable",
  };
}
