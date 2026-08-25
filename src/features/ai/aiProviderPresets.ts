import type {
  AiProviderConfig,
  AiProviderType,
} from "../../shared/tauri/aiClient";

export type AiPresetIcon =
  | "deepseek"
  | "openai"
  | "qwen"
  | "zhipu"
  | "kimi"
  | "minimax"
  | "baidu"
  | "doubao"
  | "siliconcloud"
  | "gateway"
  | "custom";

export interface AiProviderPreset {
  id: string;
  label: string;
  providerType: Exclude<AiProviderType, "offline_test">;
  displayName: string;
  baseUrl: string;
  modelName: string;
  apiKeyUrl?: string;
  icon: AiPresetIcon;
}

/**
 * A curated preset catalogue inspired by CC Switch's provider cards. Presets
 * only fill in safe, non-sensitive defaults; the API key is always entered and
 * stored through KyStudy's existing credential bridge.
 */
export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    providerType: "deepseek_chat",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    modelName: "deepseek-chat",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    icon: "deepseek",
  },
  {
    id: "openai",
    label: "OpenAI",
    providerType: "openai_responses",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    modelName: "gpt-4o-mini",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    icon: "openai",
  },
  {
    id: "qwen",
    label: "通义千问",
    providerType: "qwen_chat",
    displayName: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelName: "qwen-plus",
    apiKeyUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key",
    icon: "qwen",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    providerType: "zhipu_chat",
    displayName: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    modelName: "glm-5.2",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    icon: "zhipu",
  },
  {
    id: "kimi",
    label: "Kimi",
    providerType: "openai_chat",
    displayName: "Kimi",
    baseUrl: "https://api.moonshot.ai/v1",
    modelName: "kimi-k3",
    apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
    icon: "kimi",
  },
  {
    id: "minimax",
    label: "MiniMax",
    providerType: "openai_chat",
    displayName: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    modelName: "MiniMax-M2.7",
    apiKeyUrl:
      "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    icon: "minimax",
  },
  {
    id: "baidu-qianfan",
    label: "百度千帆",
    providerType: "openai_chat",
    displayName: "百度千帆",
    baseUrl: "https://qianfan.baidubce.com/v2",
    modelName: "ernie-4.0-turbo-8k",
    apiKeyUrl: "https://console.bce.baidu.com/qianfan/ais/console/apiKey",
    icon: "baidu",
  },
  {
    id: "doubao",
    label: "豆包 / 火山方舟",
    providerType: "doubao_responses",
    displayName: "豆包 / 火山方舟",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    modelName: "doubao-seed-2-0-lite-260215",
    apiKeyUrl:
      "https://console.volcengine.com/ark/region:ark+cn-beijing/apikey",
    icon: "doubao",
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    providerType: "openai_chat",
    displayName: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    modelName: "deepseek-ai/DeepSeek-V3",
    apiKeyUrl: "https://cloud.siliconflow.cn/account/ak",
    icon: "siliconcloud",
  },
  {
    id: "openai-compatible",
    label: "OpenAI 兼容网关",
    providerType: "litellm_gateway",
    displayName: "OpenAI 兼容网关",
    baseUrl: "http://127.0.0.1:4000/v1",
    modelName: "",
    icon: "gateway",
  },
  {
    id: "custom",
    label: "自定义配置",
    providerType: "litellm_gateway",
    displayName: "自定义 AI Provider",
    baseUrl: "",
    modelName: "",
    icon: "custom",
  },
];

export function findAiProviderPreset(
  provider: Pick<AiProviderConfig, "providerType" | "baseUrl" | "displayName">,
): AiProviderPreset | undefined {
  const normalizedBaseUrl = provider.baseUrl?.replace(/\/+$/, "") ?? "";
  return AI_PROVIDER_PRESETS.find(
    (preset) =>
      preset.id !== "custom" &&
      preset.providerType === provider.providerType &&
      preset.baseUrl.replace(/\/+$/, "") === normalizedBaseUrl,
  );
}

export function findAiProviderPresetById(
  id: string | undefined,
): AiProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === id);
}
