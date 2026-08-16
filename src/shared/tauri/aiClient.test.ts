import { describe, expect, it } from "vitest";

import {
  normalizeAiError,
  parseAiCallPreview,
  parseQuestionAiAnalysisHistory,
  parseAiOverview,
} from "./aiClient";

const OVERVIEW = {
  providers: [
    {
      id: "provider-id",
      providerType: "offline_test",
      displayName: "离线测试 Provider",
      baseUrl: null,
      modelName: "kystudy-offline-test-v1",
      contextLimit: 128000,
      maxOutputTokens: 800,
      hasSecret: false,
      active: true,
      secretRef: "private-reference",
    },
  ],
  activeProviderId: "provider-id",
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

    expect(overview.providers[0]?.providerType).toBe("offline_test");
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

  it("rejects an overview without exactly one active provider", () => {
    expect(() =>
      parseAiOverview({
        ...OVERVIEW,
        providers: OVERVIEW.providers.map((provider) => ({
          ...provider,
          active: false,
        })),
      }),
    ).toThrowError("AI_OVERVIEW_INVALID");
  });

  it("rejects an active id that points at an inactive provider", () => {
    expect(() =>
      parseAiOverview({
        ...OVERVIEW,
        providers: [
          { ...OVERVIEW.providers[0], active: false },
          {
            ...OVERVIEW.providers[0],
            id: "another-provider",
            active: true,
          },
        ],
      }),
    ).toThrowError("AI_OVERVIEW_INVALID");
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

describe("parseQuestionAiAnalysisHistory", () => {
  it("parses newest-first question analysis entries", () => {
    const history = parseQuestionAiAnalysisHistory([
      {
        sourceFingerprint: "source-v1",
        result: {
          callId: "call-id",
          responseText: "解析内容",
          inputTokens: 10,
          outputTokens: 20,
          cachedInputTokens: 0,
          reasoningTokens: 0,
          usageSource: "cache",
          cacheHit: true,
          finishedAt: 2,
        },
      },
    ]);

    expect(history[0]?.result.responseText).toBe("解析内容");
  });

  it("rejects malformed question analysis history", () => {
    expect(() => parseQuestionAiAnalysisHistory({})).toThrowError(
      "AI_HISTORY_INVALID",
    );
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
