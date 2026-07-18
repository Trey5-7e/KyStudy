import { describe, expect, it } from "vitest";

import {
  normalizeBackupCommandError,
  parseBackupReport,
  parseRestoreReport,
} from "./backupClient";

describe("parseBackupReport", () => {
  it("returns verified metadata without accepting a destination path", () => {
    const report = parseBackupReport({
      directoryName: "KyStudy-backup-1700000000000-id",
      blobCount: 2,
      totalBytes: 4096,
      createdAt: 1_700_000_000_000,
      path: "F:\\private\\backup",
    });

    expect(report).toEqual({
      directoryName: "KyStudy-backup-1700000000000-id",
      blobCount: 2,
      totalBytes: 4096,
      createdAt: 1_700_000_000_000,
    });
    expect("path" in report).toBe(false);
  });

  it("rejects a directory name containing path separators", () => {
    expect(() =>
      parseBackupReport({
        directoryName: "..\\outside",
        blobCount: 0,
        totalBytes: 0,
        createdAt: 1_700_000_000_000,
      }),
    ).toThrowError("BACKUP_REPORT_INVALID");
  });
});

describe("parseRestoreReport", () => {
  it("rejects an unsafe byte count", () => {
    expect(() =>
      parseRestoreReport({
        directoryName: "KyStudy-restored-safe",
        blobCount: 1,
        totalBytes: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrowError("RESTORE_REPORT_INVALID");
  });
});

describe("normalizeBackupCommandError", () => {
  it("does not expose arbitrary backend text", () => {
    const error = normalizeBackupCommandError({
      code: "UNKNOWN_BACKUP_ERROR",
      message: "F:\\private\\backup",
    });

    expect(error.code).toBe("BACKUP_UNAVAILABLE");
  });
});
