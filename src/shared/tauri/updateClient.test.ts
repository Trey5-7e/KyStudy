import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

import {
  checkForApplicationUpdate,
  normalizeUpdateError,
  type ApplicationUpdateProgress,
} from "./updateClient";

const mockedCheck = vi.mocked(check);

function createUpdate(
  overrides: Partial<
    Pick<Update, "currentVersion" | "version" | "date" | "body">
  > & {
    downloadAndInstall?: Update["downloadAndInstall"];
    close?: Update["close"];
  } = {},
): Update {
  return {
    currentVersion: "0.1.2",
    version: "0.1.3",
    date: "2026-08-17T08:00:00Z",
    body: "修复更新流程并改善稳定性。",
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Update;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkForApplicationUpdate", () => {
  it("maps no-update responses and uses the check timeout", async () => {
    mockedCheck.mockResolvedValueOnce(null);

    await expect(checkForApplicationUpdate()).resolves.toBeNull();
    expect(mockedCheck).toHaveBeenCalledWith({ timeout: 30_000 });
  });

  it("shares an in-flight check instead of sending duplicate requests", async () => {
    let resolveCheck: (value: Update | null) => void = () => undefined;
    const pendingCheck = new Promise<Update | null>((resolve) => {
      resolveCheck = resolve;
    });
    mockedCheck.mockReturnValueOnce(pendingCheck);

    const first = checkForApplicationUpdate();
    const second = checkForApplicationUpdate();
    await Promise.resolve();
    expect(mockedCheck).toHaveBeenCalledOnce();

    resolveCheck(null);
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
  });

  it("allows a new check after a failed request", async () => {
    mockedCheck.mockRejectedValueOnce(new Error("network"));
    await expect(checkForApplicationUpdate()).rejects.toThrow("network");

    mockedCheck.mockResolvedValueOnce(null);
    await expect(checkForApplicationUpdate()).resolves.toBeNull();
    expect(mockedCheck).toHaveBeenCalledTimes(2);
  });

  it("maps update metadata and closes the updater resource", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    mockedCheck.mockResolvedValueOnce(createUpdate({ close }));

    const update = await checkForApplicationUpdate();

    expect(update).not.toBeNull();
    expect(update).toMatchObject({
      currentVersion: "0.1.2",
      version: "0.1.3",
      date: "2026-08-17T08:00:00Z",
      notes: "修复更新流程并改善稳定性。",
    });

    await update?.close();
    expect(close).toHaveBeenCalledOnce();

    mockedCheck.mockResolvedValueOnce(
      createUpdate({ date: undefined, body: undefined }),
    );
    const updateWithoutMetadata = await checkForApplicationUpdate();
    expect(updateWithoutMetadata).toMatchObject({ date: null, notes: null });
  });

  it("reports bounded progress for known and unknown download lengths", async () => {
    const downloadAndInstall = vi.fn(
      async (onEvent?: (event: DownloadEvent) => void) => {
        onEvent?.({ event: "Started", data: { contentLength: 100 } });
        onEvent?.({ event: "Progress", data: { chunkLength: 30 } });
        onEvent?.({ event: "Progress", data: { chunkLength: 90 } });
        onEvent?.({ event: "Finished" });
      },
    );
    mockedCheck.mockResolvedValueOnce(createUpdate({ downloadAndInstall }));

    const update = await checkForApplicationUpdate();
    const progress: ApplicationUpdateProgress[] = [];

    await update?.install((next) => progress.push(next));

    expect(progress).toEqual([
      { downloadedBytes: 0, contentLength: 100, percent: 0 },
      { downloadedBytes: 30, contentLength: 100, percent: 30 },
      { downloadedBytes: 120, contentLength: 100, percent: 100 },
      { downloadedBytes: 120, contentLength: 100, percent: 100 },
    ]);
    expect(downloadAndInstall).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 600_000,
    });

    const unknownLengthDownload = vi.fn(
      async (onEvent?: (event: DownloadEvent) => void) => {
        onEvent?.({ event: "Started", data: {} });
        onEvent?.({ event: "Progress", data: { chunkLength: 12 } });
      },
    );
    mockedCheck.mockResolvedValueOnce(
      createUpdate({ downloadAndInstall: unknownLengthDownload }),
    );
    const unknownLengthUpdate = await checkForApplicationUpdate();
    const unknownLengthProgress: ApplicationUpdateProgress[] = [];
    await unknownLengthUpdate?.install((next) =>
      unknownLengthProgress.push(next),
    );

    expect(unknownLengthProgress).toEqual([
      { downloadedBytes: 0, contentLength: null, percent: null },
      { downloadedBytes: 12, contentLength: null, percent: null },
    ]);
  });
});

describe("update client errors", () => {
  it("does not expose arbitrary updater errors", () => {
    expect(
      normalizeUpdateError(new Error("private endpoint and token details")),
    ).toBe("暂时无法连接更新服务，请检查网络后重试。");
  });

  it("gives a specific message for aborted checks", () => {
    const error = new Error("aborted");
    error.name = "AbortError";

    expect(normalizeUpdateError(error)).toBe("更新检查超时，请稍后重试。");
  });

  it("uses the download timeout message for aborted installs", () => {
    const error = new Error("aborted");
    error.name = "AbortError";

    expect(normalizeUpdateError(error, "download")).toBe(
      "下载更新超时，请检查网络后重试。",
    );
  });

  it("recognizes timeout and signature errors from updater payloads", () => {
    expect(
      normalizeUpdateError({ message: "request timed out" }, "download"),
    ).toBe("下载更新超时，请检查网络后重试。");
    expect(
      normalizeUpdateError(
        { reason: "signature verification failed" },
        "download",
      ),
    ).toBe("更新包签名校验失败，请重新检查更新。");
  });

  it("uses a download-specific fallback for non-network install failures", () => {
    expect(
      normalizeUpdateError(new Error("installer failed"), "download"),
    ).toBe("更新包下载或安装失败，请检查网络后重试。");
  });
});
