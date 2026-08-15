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

const UPDATE_CHECK_TIMEOUT_MS = 15_000;

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
        { timeout: UPDATE_CHECK_TIMEOUT_MS },
      );
    },
    close: () => update.close(),
  };
}

export async function checkForApplicationUpdate(): Promise<AvailableApplicationUpdate | null> {
  const update = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
  return update === null ? null : createApplicationUpdate(update);
}

export function normalizeUpdateError(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "更新检查超时，请稍后重试。";
  }

  return "暂时无法连接更新服务，请检查网络后重试。";
}
