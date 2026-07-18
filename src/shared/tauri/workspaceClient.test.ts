import { describe, expect, it } from "vitest";

import {
  normalizeWorkspaceCommandError,
  parseWorkspaceStatus,
} from "./workspaceClient";

const VALID_STATUS = {
  id: "018f4f5d-57c4-7a22-ae1c-f3dbdb28be31",
  name: "我的考研工作区",
  timezone: "Asia/Shanghai",
  dailyReviewQuota: 5,
  earlyFillEnabled: false,
  createdAt: 1_700_000_000_000,
  schemaVersion: 1,
};

describe("parseWorkspaceStatus", () => {
  it("returns null before a workspace is initialized", () => {
    expect(parseWorkspaceStatus(null)).toBeNull();
  });

  it("returns typed metadata without a storage path", () => {
    const workspace = parseWorkspaceStatus(VALID_STATUS);

    expect(workspace).toEqual(VALID_STATUS);
  });

  it("rejects an invalid daily review quota", () => {
    expect(() =>
      parseWorkspaceStatus({ ...VALID_STATUS, dailyReviewQuota: 0 }),
    ).toThrowError("WORKSPACE_STATUS_INVALID");
  });
});

describe("normalizeWorkspaceCommandError", () => {
  it("maps a known stable code without trusting backend message text", () => {
    const error = normalizeWorkspaceCommandError({
      code: "DATABASE_BUSY",
      message: "C:\\private\\workspace\\kystudy.sqlite3",
      operationId: "operation-1",
    });

    expect(error.message).toBe("本地数据库正在被占用，请稍后重试。");
  });

  it("does not expose arbitrary exception text", () => {
    const error = normalizeWorkspaceCommandError(
      new Error("C:\\private\\workspace\\kystudy.sqlite3"),
    );

    expect(error.code).toBe("WORKSPACE_UNAVAILABLE");
  });
});
