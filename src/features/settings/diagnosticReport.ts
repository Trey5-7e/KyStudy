import type { RuntimeStatus } from "../../shared/tauri/runtimeClient";
import type { WorkspaceStatus } from "../../shared/tauri/workspaceClient";

export const DIAGNOSTIC_FORMAT_VERSION = 1;

export interface DiagnosticReport {
  formatVersion: typeof DIAGNOSTIC_FORMAT_VERSION;
  generatedAt: string;
  runtime: {
    appVersion: string;
    schemaVersion: number;
    platform: string;
    architecture: string;
    buildProfile: "debug" | "release";
  };
  workspace:
    | {
        state: "ready";
        schemaVersion: number;
        timezone: string;
        dailyReviewQuota: number;
        earlyFillEnabled: boolean;
      }
    | { state: "not_initialized" };
  exclusions: readonly string[];
}

const EXCLUSIONS = [
  "学习资料、PDF、题图和题目正文",
  "API Key、密钥和凭据",
  "绝对路径、SQL、请求正文和 AI 响应",
  "临时文件、日志原文和堆栈",
] as const;

export function buildDiagnosticReport(
  runtime: RuntimeStatus,
  workspace: WorkspaceStatus | null,
  generatedAt = Date.now(),
): DiagnosticReport {
  return {
    formatVersion: DIAGNOSTIC_FORMAT_VERSION,
    generatedAt: new Date(generatedAt).toISOString(),
    runtime: {
      appVersion: runtime.appVersion,
      schemaVersion: runtime.schemaVersion,
      platform: runtime.platform,
      architecture: runtime.architecture,
      buildProfile: runtime.buildProfile,
    },
    workspace:
      workspace === null
        ? { state: "not_initialized" }
        : {
            state: "ready",
            schemaVersion: workspace.schemaVersion,
            timezone: workspace.timezone,
            dailyReviewQuota: workspace.dailyReviewQuota,
            earlyFillEnabled: workspace.earlyFillEnabled,
          },
    exclusions: EXCLUSIONS,
  };
}

export function serializeDiagnosticReport(report: DiagnosticReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function diagnosticFileName(generatedAt: string): string {
  const safeTimestamp = generatedAt
    .replace(/[^0-9]/g, "")
    .slice(0, 14)
    .padEnd(14, "0");
  return `kystudy-diagnostic-${safeTimestamp}.json`;
}
