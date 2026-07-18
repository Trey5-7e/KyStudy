import { describe, expect, it } from "vitest";

import { normalizeCommandError, parseRuntimeStatus } from "./runtimeClient";

describe("parseRuntimeStatus", () => {
  it("returns a typed status when every field is valid", () => {
    const status = parseRuntimeStatus({
      appVersion: "0.1.0",
      schemaVersion: 0,
      platform: "windows",
      architecture: "x86_64",
    });

    expect(status.schemaVersion).toBe(0);
  });

  it("rejects a missing platform field", () => {
    expect(() =>
      parseRuntimeStatus({
        appVersion: "0.1.0",
        schemaVersion: 0,
        architecture: "x86_64",
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
