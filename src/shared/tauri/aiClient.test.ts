import { describe, expect, it } from "vitest";

import {
  parseAiModelOptions,
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
      capabilities: {
        supportsImage: "unknown",
        supportsFile: "unknown",
        supportsPdf: "unknown",
        capabilitySource: "unknown",
      },
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
    expect(overview.providers[0]?.capabilities.supportsPdf).toBe("unknown");
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

  it("accepts the SenseNova native chat provider type", () => {
    const overview = parseAiOverview({
      ...OVERVIEW,
      providers: [
        {
          ...OVERVIEW.providers[0],
          providerType: "sensenova_chat",
          displayName: "SenseNova",
          baseUrl: "https://api.sensenova.cn/v1/llm",
          modelName: "SenseNova-V6-5-Pro",
          hasSecret: true,
          active: true,
        },
      ],
    });

    expect(overview.providers[0]?.providerType).toBe("sensenova_chat");
  });
});

describe("parseAiModelOptions", () => {
  it("accepts the standard model envelope and sorts unique IDs", () => {
    const models = parseAiModelOptions({
      object: "list",
      data: [
        { id: "Z-model", owned_by: "provider", created: 2 },
        { id: "a-model" },
        { id: "Z-model" },
      ],
    });

    expect(models.map((model) => model.id)).toEqual(["a-model", "Z-model"]);
    expect(models[1]?.ownedBy).toBe("provider");
  });

  it("allows a missing object field for compatible providers", () => {
    expect(parseAiModelOptions({ data: [{ id: "model" }] })).toEqual([
      { id: "model", ownedBy: undefined, createdAt: undefined },
    ]);
  });

  it("accepts SenseNova's uppercase LIST envelope", () => {
    expect(
      parseAiModelOptions({ object: "LIST", data: [{ id: "SenseNova" }] }),
    ).toEqual([{ id: "SenseNova", ownedBy: undefined, createdAt: undefined }]);
  });

  it("rejects a non-list envelope or invalid model ID", () => {
    expect(() =>
      parseAiModelOptions({ object: "model", data: [{ id: "model" }] }),
    ).toThrowError("AI_MODEL_LIST_INVALID");
    expect(() => parseAiModelOptions({ data: [{ id: "" }] })).toThrowError(
      "AI_MODEL_LIST_INVALID",
    );
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

  it("explains workspace persistence failures without exposing internals", () => {
    const error = normalizeAiError({
      code: "MIGRATION_FAILED",
      message: "raw sqlite error",
      action: "ALTER TABLE ...",
    });

    expect(error).toEqual({
      code: "MIGRATION_FAILED",
      message: "工作区数据库升级未能安全完成。",
      action: "不要覆盖工作区文件，请重启应用后重试。",
      operationId: undefined,
    });
    expect(JSON.stringify(error)).not.toContain("sqlite");
    expect(JSON.stringify(error)).not.toContain("ALTER TABLE");
  });

  it("keeps the provider error copy when Tauri rejects with an Error", () => {
    const error = normalizeAiError(new Error("AI_PROVIDER_RESPONSE_INVALID"));

    expect(error).toEqual({
      code: "AI_PROVIDER_RESPONSE_INVALID",
      message: "Provider 返回了无法识别的结果。",
      action: "确认该地址兼容所选 Provider 协议。",
      operationId: undefined,
    });
  });

  it("explains local contract failures instead of hiding their stable code", () => {
    const error = normalizeAiError(new Error("AI_RESULT_INVALID"));

    expect(error.code).toBe("AI_RESULT_INVALID");
    expect(error.message).toBe("AI 回复数据格式不完整。");
    expect(error.message).not.toContain("无法识别的 AI 数据");
  });

  it("does not echo arbitrary Error messages as AI codes", () => {
    const error = normalizeAiError(new Error("provider body: sk-secret"));

    expect(error.code).toBe("AI_UNAVAILABLE");
    expect(JSON.stringify(error)).not.toContain("sk-secret");
  });
});
