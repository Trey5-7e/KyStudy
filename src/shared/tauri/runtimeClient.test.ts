import { describe, expect, it } from "vitest";

import {
  formatDataDirectoryForDisplay,
  normalizeCommandError,
  parseRuntimeStatus,
} from "./runtimeClient";

describe("parseRuntimeStatus", () => {
  it("returns a typed status when every field is valid", () => {
    const status = parseRuntimeStatus({
      appVersion: "0.1.0",
      schemaVersion: 0,
      platform: "windows",
      architecture: "x86_64",
      buildProfile: "release",
      dataDirectory: "C:\\KyStudy\\data",
    });

    expect(status.schemaVersion).toBe(0);
  });

  it("rejects a missing platform field", () => {
    expect(() =>
      parseRuntimeStatus({
        appVersion: "0.1.0",
        schemaVersion: 0,
        architecture: "x86_64",
        buildProfile: "release",
        dataDirectory: "C:\\KyStudy\\data",
      }),
    ).toThrowError("RUNTIME_STATUS_INVALID");
  });

  it("rejects a fractional schema version", () => {
    expect(() =>
      parseRuntimeStatus({
        appVersion: "0.1.0",
        schemaVersion: 0.5,
        platform: "windows",
        architecture: "x86_64",
        buildProfile: "release",
        dataDirectory: "C:\\KyStudy\\data",
      }),
    ).toThrowError("RUNTIME_STATUS_INVALID");
  });
});

describe("normalizeCommandError", () => {
  it("does not expose arbitrary exception text", () => {
    const normalized = normalizeCommandError(
      new Error("C:\\private\\workspace\\kystudy.sqlite3"),
    );

    expect(normalized).toEqual({
      code: "LOCAL_CORE_UNAVAILABLE",
      message: "暂时无法连接本地核心。请在 KyStudy 桌面应用中重试。",
    });
  });
});

describe("formatDataDirectoryForDisplay", () => {
  it("removes the Windows extended-length prefix", () => {
    expect(
      formatDataDirectoryForDisplay("\\\\?\\C:\\Users\\tester\\data"),
    ).toBe("C:\\Users\\tester\\data");
  });

  it("converts an extended UNC path to a normal UNC path", () => {
    expect(
      formatDataDirectoryForDisplay("\\\\?\\UNC\\server\\share\\data"),
    ).toBe("\\\\server\\share\\data");
  });

  it("leaves ordinary paths unchanged", () => {
    expect(formatDataDirectoryForDisplay("D:\\KyStudy\\data")).toBe(
      "D:\\KyStudy\\data",
    );
  });
});
