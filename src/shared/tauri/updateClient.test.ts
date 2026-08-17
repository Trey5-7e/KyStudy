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
