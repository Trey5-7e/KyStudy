import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";

export interface ApplicationUpdateProgress {
  downloadedBytes: number;
  contentLength: number | null;
  percent: number | null;
}

export interface AvailableApplicationUpdate {
  currentVersion: string;
  version: string;
  date: string | null;
  notes: string | null;
  install(
    onProgress?: (progress: ApplicationUpdateProgress) => void,
  ): Promise<void>;
  close(): Promise<void>;
}

const UPDATE_CHECK_TIMEOUT_MS = 30_000;
// Allow slower networks and larger signed installers enough time to finish.
const UPDATE_DOWNLOAD_TIMEOUT_MS = 600_000;

type UpdateErrorPhase = "check" | "download";

let inFlightCheck: Promise<AvailableApplicationUpdate | null> | null = null;

function mapProgress(
  downloadedBytes: number,
  contentLength: number | null,
): ApplicationUpdateProgress {
  return {
    downloadedBytes,
    contentLength,
    percent:
      contentLength !== null && contentLength > 0
        ? Math.min(100, Math.round((downloadedBytes / contentLength) * 100))
        : null,
  };
}

function createApplicationUpdate(update: Update): AvailableApplicationUpdate {
  return {
    currentVersion: update.currentVersion,
    version: update.version,
    date: update.date ?? null,
    notes: update.body ?? null,
    install: async (onProgress) => {
      let downloadedBytes = 0;
      let contentLength: number | null = null;

      await update.downloadAndInstall(
        (event: DownloadEvent) => {
          if (event.event === "Started") {
            contentLength = event.data.contentLength ?? null;
          } else if (event.event === "Progress") {
            downloadedBytes += event.data.chunkLength;
          }

          onProgress?.(mapProgress(downloadedBytes, contentLength));
        },
        { timeout: UPDATE_DOWNLOAD_TIMEOUT_MS },
      );
    },
    close: () => update.close(),
  };
}

export function checkForApplicationUpdate(): Promise<AvailableApplicationUpdate | null> {
  if (inFlightCheck !== null) return inFlightCheck;

  const request = Promise.resolve()
    .then(() => check({ timeout: UPDATE_CHECK_TIMEOUT_MS }))
    .then((update) =>
      update === null ? null : createApplicationUpdate(update),
    );
  const trackedRequest = request.finally(() => {
    if (inFlightCheck === trackedRequest) {
      inFlightCheck = null;
    }
  });
  inFlightCheck = trackedRequest;
  return trackedRequest;
}

export function normalizeUpdateError(
  error: unknown,
  phase: UpdateErrorPhase = "check",
): string {
  if (isUpdateTimeoutError(error)) {
    return phase === "download"
      ? "下载更新超时，请检查网络后重试。"
      : "更新检查超时，请稍后重试。";
  }

  if (phase === "download") {
    if (isUpdateSignatureError(error)) {
      return "更新包签名校验失败，请重新检查更新。";
    }
    return "更新包下载或安装失败，请检查网络后重试。";
  }

  return "暂时无法连接更新服务，请检查网络后重试。";
}

function isUpdateTimeoutError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  return /(?:timeout|timed[ -]?out|deadline|operation canceled)/i.test(
    updateErrorText(error),
  );
}

function isUpdateSignatureError(error: unknown): boolean {
  return /(?:signature|public key|pubkey|签名|公钥)/i.test(
    updateErrorText(error),
  );
}

function updateErrorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  if (typeof error === "string") return error;
  if (isRecord(error)) {
    return [error.name, error.message, error.code, error.kind, error.reason]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
