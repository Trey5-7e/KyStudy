import { describe, expect, it } from "vitest";

import type { RuntimeStatus } from "../../shared/tauri/runtimeClient";
import type { WorkspaceStatus } from "../../shared/tauri/workspaceClient";
import {
  buildDiagnosticReport,
  diagnosticFileName,
  serializeDiagnosticReport,
} from "./diagnosticReport";

const runtime: RuntimeStatus = {
  appVersion: "0.1.0",
  schemaVersion: 22,
  platform: "windows",
  architecture: "x86_64",
};

const workspace: WorkspaceStatus = {
  id: "sensitive-id",
  name: "个人工作区",
  timezone: "Asia/Shanghai",
  dailyReviewQuota: 20,
  earlyFillEnabled: true,
  createdAt: 1,
  schemaVersion: 22,
};

describe("diagnostic report", () => {
  it("keeps only non-sensitive runtime and workspace metadata", () => {
    const report = buildDiagnosticReport(runtime, workspace, 0);
    const serialized = serializeDiagnosticReport(report);

    expect(report.generatedAt).toBe("1970-01-01T00:00:00.000Z");
    expect(report.workspace).toEqual({
      state: "ready",
      schemaVersion: 22,
      timezone: "Asia/Shanghai",
      dailyReviewQuota: 20,
      earlyFillEnabled: true,
    });
    expect(serialized).not.toContain("sensitive-id");
    expect(serialized).not.toContain("个人工作区");
    expect(report.exclusions).toContain("API Key、密钥和凭据");
  });

  it("represents an uninitialized workspace without inventing data", () => {
    expect(buildDiagnosticReport(runtime, null, 0).workspace).toEqual({
      state: "not_initialized",
    });
  });

  it("creates a stable safe filename", () => {
    expect(diagnosticFileName("2026-08-13T14:30:45.000Z")).toBe(
      "kystudy-diagnostic-20260813143045.json",
    );
  });
});
