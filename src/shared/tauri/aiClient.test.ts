import { describe, expect, it } from "vitest";

import {
  normalizeAiError,
  parseAiCallPreview,
  parseAiOverview,
} from "./aiClient";

const OVERVIEW = {
  provider: {
    providerType: "offline_test",
    displayName: "离线测试 Provider",
    baseUrl: null,
    modelName: "kystudy-offline-test-v1",
    contextLimit: 128000,
    maxOutputTokens: 800,
    hasSecret: false,
    secretRef: "private-reference",
  },
  budget: {
    singleCallLimit: 8000,
    dailyTokenLimit: 50000,
    monthlyTokenLimit: 1000000,
    limitMode: "block",
  },
  usage: { todayTokens: 10, monthTokens: 20 },
  calls: [
    {
      id: "call-id",
      providerName: "离线测试 Provider",
      modelName: "kystudy-offline-test-v1",
      state: "succeeded",
      cacheHit: false,
      inputTokens: 10,
      outputTokens: 20,
      errorCode: null,
      startedAt: 1,
      finishedAt: 2,
      requestFingerprint: "private-fingerprint",
    },
  ],
  databasePath: "C:/private.sqlite3",
};

describe("parseAiOverview", () => {
  it("keeps public configuration without secret or storage internals", () => {
    const overview = parseAiOverview(OVERVIEW);
    const serialized = JSON.stringify(overview);

    expect(overview.provider.providerType).toBe("offline_test");
    expect(serialized).not.toContain("secretRef");
    expect(serialized).not.toContain("requestFingerprint");
    expect(serialized).not.toContain("databasePath");
  });

  it("rejects unknown call states", () => {
    expect(() =>
      parseAiOverview({
        ...OVERVIEW,
        calls: [{ ...OVERVIEW.calls[0], state: "streaming" }],
      }),
    ).toThrowError("AI_CALL_INVALID");
  });
});

describe("parseAiCallPreview", () => {
  it("rejects internal warning values", () => {
    expect(() =>
      parseAiCallPreview({
        providerName: "Provider",
        providerType: "offline_test",
        modelName: "model",
        destination: "本机",
        prompt: "测试",
        inputTokenEstimate: 10,
        outputTokenLimit: 100,
        projectedTokens: 110,
        todayTokens: 0,
        monthTokens: 0,
        allowed: true,
        warnings: ["sql_limit"],
      }),
    ).toThrowError("AI_PREVIEW_INVALID");
  });
});

describe("normalizeAiError", () => {
  it("does not pass through a raw provider body", () => {
    const error = normalizeAiError({
      code: "AI_PROVIDER_UNAVAILABLE",
      message: "raw response with sk-secret",
      action: "SELECT * FROM ai_call",
    });
    expect(JSON.stringify(error)).not.toContain("sk-secret");
    expect(JSON.stringify(error)).not.toContain("SELECT");
  });
});
