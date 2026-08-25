import { describe, expect, it } from "vitest";

import {
  AI_PROVIDER_PRESETS,
  findAiProviderPreset,
  findAiProviderPresetById,
} from "./aiProviderPresets";

describe("ai provider presets", () => {
  it("keeps the CC Switch-inspired domestic provider catalogue stable", () => {
    expect(AI_PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
      "deepseek",
      "openai",
      "qwen",
      "zhipu",
      "kimi",
      "minimax",
      "baidu-qianfan",
      "doubao",
      "siliconflow",
      "openai-compatible",
      "custom",
    ]);
  });

  it("matches a configured provider by protocol and endpoint", () => {
    expect(
      findAiProviderPreset({
        providerType: "deepseek_chat",
        baseUrl: "https://api.deepseek.com/",
        displayName: "My DeepSeek",
      })?.id,
    ).toBe("deepseek");
    expect(
      findAiProviderPreset({
        providerType: "litellm_gateway",
        baseUrl: "http://127.0.0.1:4000/v1/",
        displayName: "Local gateway",
      })?.id,
    ).toBe("openai-compatible");
    expect(
      findAiProviderPreset({
        providerType: "openai_chat",
        baseUrl: "https://api.minimaxi.com/v1/",
        displayName: "My MiniMax",
      })?.id,
    ).toBe("minimax");
  });

  it("returns undefined for custom endpoints and unknown ids", () => {
    expect(
      findAiProviderPreset({
        providerType: "deepseek_chat",
        baseUrl: "https://proxy.example.test/v1",
        displayName: "Proxy",
      }),
    ).toBeUndefined();
    expect(findAiProviderPresetById("missing")).toBeUndefined();
  });
});
