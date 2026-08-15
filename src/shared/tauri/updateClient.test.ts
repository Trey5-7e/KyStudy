import { describe, expect, it } from "vitest";

import { normalizeUpdateError } from "./updateClient";

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
});
