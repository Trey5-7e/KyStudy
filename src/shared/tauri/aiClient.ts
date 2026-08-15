import { invoke } from "@tauri-apps/api/core";

export type AiProviderType = "offline_test" | "openai_responses";
export type AiLimitMode = "warn" | "block";
export type AiCallState = "pending" | "succeeded" | "failed";

export interface AiProviderConfig {
  id: string;
  providerType: AiProviderType;
  displayName: string;
  baseUrl?: string;
  modelName: string;
  contextLimit: number;
  maxOutputTokens: number;
  hasSecret: boolean;
  active: boolean;
}

export interface AiBudget {
  singleCallLimit: number;
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  limitMode: AiLimitMode;
}

export interface AiUsage {
  todayTokens: number;
  monthTokens: number;
}

export interface AiCallSummary {
  id: string;
  providerName: string;
  modelName: string;
  state: AiCallState;
  cacheHit: boolean;
  inputTokens: number;
  outputTokens: number;
  errorCode?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface AiOverview {
  providers: AiProviderConfig[];
  activeProviderId: string;
  budget: AiBudget;
  usage: AiUsage;
  calls: AiCallSummary[];
}

export interface AiCallPreview {
  providerName: string;
  providerType: AiProviderType;
  modelName: string;
  destination: string;
  prompt: string;
  inputTokenEstimate: number;
  outputTokenLimit: number;
  projectedTokens: number;
  todayTokens: number;
  monthTokens: number;
  allowed: boolean;
  warnings: Array<"single_call" | "daily" | "monthly">;
}

export interface AiCallResult {
  callId: string;
  responseText: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  usageSource: "provider" | "estimated" | "cache";
  cacheHit: boolean;
  finishedAt: number;
}

export interface AiCommandError {
  code: string;
  message: string;
  action: string;
  operationId?: string;
}

const PROVIDER_TYPES = new Set<AiProviderType>([
  "offline_test",
  "openai_responses",
]);
const LIMIT_MODES = new Set<AiLimitMode>(["warn", "block"]);
const CALL_STATES = new Set<AiCallState>(["pending", "succeeded", "failed"]);
const WARNING_TYPES = new Set<AiCallPreview["warnings"][number]>([
  "single_call",
  "daily",
  "monthly",
]);
const USAGE_SOURCES = new Set<AiCallResult["usageSource"]>([
  "provider",
  "estimated",
  "cache",
]);

const ERROR_COPY: Record<string, { message: string; action: string }> = {
  WORKSPACE_NOT_INITIALIZED: {
    message: "尚未创建本地工作区。",
    action: "先创建工作区，再配置 AI。",
  },
  AI_CONFIGURATION_NOT_FOUND: {
    message: "AI 配置尚未初始化。",
    action: "刷新 AI 面板后重试。",
  },
  AI_INPUT_INVALID: {
    message: "AI 配置、文本或 Token 上限无效。",
    action: "检查输入内容与数值后重新预览。",
  },
  AI_PROVIDER_LIMIT_REACHED: {
    message: "AI Provider 已达到 20 个本地配置上限。",
    action: "删除不再使用的 Provider 后重试。",
  },
  AI_BUDGET_BLOCKED: {
    message: "本次调用已被 Token 硬预算阻止。",
    action: "减少发送内容或输出上限，或明确调整预算。",
  },
  AI_SECRET_MISSING: {
    message: "当前 Provider 尚未保存 API Key。",
    action: "先把密钥保存到系统凭据存储。",
  },
  AI_SECRET_STORE_UNAVAILABLE: {
    message: "Windows 安全凭据存储暂时不可用。",
    action: "确认当前用户可使用凭据管理器后重试。",
  },
  AI_PROVIDER_AUTHENTICATION_FAILED: {
    message: "Provider 拒绝了身份验证。",
    action: "检查 API Key；密钥内容不会写入日志。",
  },
  AI_PROVIDER_RATE_LIMITED: {
    message: "Provider 当前限制了请求频率或额度。",
    action: "稍后重试，并检查 Provider 侧额度。",
  },
  AI_PROVIDER_UNAVAILABLE: {
    message: "暂时无法连接 AI Provider。",
    action: "检查网络与 Provider 地址；离线功能不受影响。",
  },
  AI_PROVIDER_RESPONSE_INVALID: {
    message: "Provider 返回了无法识别的结果。",
    action: "确认该地址兼容 Responses API。",
  },
  AI_PROVIDER_REQUEST_REJECTED: {
    message: "Provider 拒绝了本次请求。",
    action: "检查模型名称和账户权限。",
  },
  DATABASE_BUSY: {
    message: "本地数据库正在被占用。",
    action: "关闭其他 KyStudy 窗口后重试。",
  },
};

export async function getAiOverview(): Promise<AiOverview> {
  return parseAiOverview(await invoke("get_ai_overview"));
}

export interface SaveAiProviderRequest {
  providerType: AiProviderType;
  displayName: string;
  baseUrl?: string;
  modelName: string;
  contextLimit: number;
  maxOutputTokens: number;
}

export async function createAiProvider(
  request: SaveAiProviderRequest,
): Promise<AiOverview> {
  return parseAiOverview(await invoke("create_ai_provider", { request }));
}

export async function updateAiProvider(
  providerId: string,
  request: SaveAiProviderRequest,
): Promise<AiOverview> {
  return parseAiOverview(
    await invoke("update_ai_provider", { providerId, request }),
  );
}

export async function activateAiProvider(
  providerId: string,
): Promise<AiOverview> {
  return parseAiOverview(await invoke("activate_ai_provider", { providerId }));
}

export async function deleteAiProvider(
  providerId: string,
): Promise<AiOverview> {
  return parseAiOverview(await invoke("delete_ai_provider", { providerId }));
}

export async function saveAiBudget(request: {
  singleCallLimit: number;
  dailyTokenLimit: number;
  monthlyTokenLimit: number;
  limitMode: AiLimitMode;
}): Promise<AiOverview> {
  return parseAiOverview(await invoke("save_ai_budget", { request }));
}

export async function saveAiSecret(
  providerId: string,
  secret: string,
): Promise<AiOverview> {
  return parseAiOverview(
    await invoke("save_ai_secret", { request: { providerId, secret } }),
  );
}

export async function deleteAiSecret(providerId: string): Promise<AiOverview> {
  return parseAiOverview(await invoke("delete_ai_secret", { providerId }));
}

export async function previewAiCall(request: {
  prompt: string;
  maxOutputTokens: number;
}): Promise<AiCallPreview> {
  return parseAiCallPreview(await invoke("preview_ai_call", { request }));
}

export async function executeAiCall(request: {
  prompt: string;
  maxOutputTokens: number;
}): Promise<AiCallResult> {
  return parseAiCallResult(await invoke("execute_ai_call", { request }));
}

export interface QuestionAiAnalysisRequest {
  prompt: string;
  imageDataUrls: string[];
  maxOutputTokens: number;
}

export async function previewQuestionAiAnalysis(
  request: QuestionAiAnalysisRequest,
): Promise<AiCallPreview> {
  return parseAiCallPreview(
    await invoke("preview_question_ai_analysis", { request }),
  );
}

export async function executeQuestionAiAnalysis(
  request: QuestionAiAnalysisRequest,
): Promise<AiCallResult> {
  return parseAiCallResult(
    await invoke("execute_question_ai_analysis", { request }),
  );
}

export function parseAiOverview(value: unknown): AiOverview {
  if (
    !isRecord(value) ||
    !Array.isArray(value.providers) ||
    typeof value.activeProviderId !== "string" ||
    !Array.isArray(value.calls)
  ) {
    throw new Error("AI_OVERVIEW_INVALID");
  }
  const providers = value.providers.map(parseProvider);
  if (
    providers.length === 0 ||
    providers.filter((provider) => provider.active).length !== 1 ||
    !providers.some(
      (provider) => provider.id === value.activeProviderId && provider.active,
    )
  ) {
    throw new Error("AI_OVERVIEW_INVALID");
  }
  return {
    providers,
    activeProviderId: value.activeProviderId,
    budget: parseBudget(value.budget),
    usage: parseUsage(value.usage),
    calls: value.calls.map(parseCallSummary),
  };
}

export function parseAiCallPreview(value: unknown): AiCallPreview {
  if (
    !isRecord(value) ||
    typeof value.providerName !== "string" ||
    !isEnum(value.providerType, PROVIDER_TYPES) ||
    typeof value.modelName !== "string" ||
    typeof value.destination !== "string" ||
    typeof value.prompt !== "string" ||
    !nonnegativeInteger(value.inputTokenEstimate) ||
    !positiveInteger(value.outputTokenLimit) ||
    !positiveInteger(value.projectedTokens) ||
    !nonnegativeInteger(value.todayTokens) ||
    !nonnegativeInteger(value.monthTokens) ||
    typeof value.allowed !== "boolean" ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every((warning) => isEnum(warning, WARNING_TYPES))
  ) {
    throw new Error("AI_PREVIEW_INVALID");
  }
  return {
    providerName: value.providerName,
    providerType: value.providerType,
    modelName: value.modelName,
    destination: value.destination,
    prompt: value.prompt,
    inputTokenEstimate: value.inputTokenEstimate,
    outputTokenLimit: value.outputTokenLimit,
    projectedTokens: value.projectedTokens,
    todayTokens: value.todayTokens,
    monthTokens: value.monthTokens,
    allowed: value.allowed,
    warnings: [...value.warnings],
  };
}

export function parseAiCallResult(value: unknown): AiCallResult {
  if (
    !isRecord(value) ||
    typeof value.callId !== "string" ||
    typeof value.responseText !== "string" ||
    !nonnegativeInteger(value.inputTokens) ||
    !nonnegativeInteger(value.outputTokens) ||
    !nonnegativeInteger(value.cachedInputTokens) ||
    !nonnegativeInteger(value.reasoningTokens) ||
    !isEnum(value.usageSource, USAGE_SOURCES) ||
    typeof value.cacheHit !== "boolean" ||
    !nonnegativeInteger(value.finishedAt)
  ) {
    throw new Error("AI_RESULT_INVALID");
  }
  return {
    callId: value.callId,
    responseText: value.responseText,
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    cachedInputTokens: value.cachedInputTokens,
    reasoningTokens: value.reasoningTokens,
    usageSource: value.usageSource,
    cacheHit: value.cacheHit,
    finishedAt: value.finishedAt,
  };
}

export function normalizeAiError(error: unknown): AiCommandError {
  if (error instanceof Error && error.message.startsWith("AI_")) {
    return {
      code: error.message,
      message: "本地核心返回了无法识别的 AI 数据。",
      action: "重新启动应用后重试。",
    };
  }
  if (isRecord(error) && typeof error.code === "string") {
    const copy = ERROR_COPY[error.code];
    if (copy !== undefined) {
      return {
        code: error.code,
        ...copy,
        operationId:
          typeof error.operationId === "string" ? error.operationId : undefined,
      };
    }
  }
  return {
    code: "AI_UNAVAILABLE",
    message: "AI 基础设施暂时不可用。",
    action: "刷新面板或重新启动应用后重试。",
  };
}

function parseProvider(value: unknown): AiProviderConfig {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isEnum(value.providerType, PROVIDER_TYPES) ||
    typeof value.displayName !== "string" ||
    !optionalString(value.baseUrl) ||
    typeof value.modelName !== "string" ||
    !positiveInteger(value.contextLimit) ||
    !positiveInteger(value.maxOutputTokens) ||
    typeof value.hasSecret !== "boolean" ||
    typeof value.active !== "boolean"
  ) {
    throw new Error("AI_PROVIDER_INVALID");
  }
  return {
    id: value.id,
    providerType: value.providerType,
    displayName: value.displayName,
    baseUrl: value.baseUrl,
    modelName: value.modelName,
    contextLimit: value.contextLimit,
    maxOutputTokens: value.maxOutputTokens,
    hasSecret: value.hasSecret,
    active: value.active,
  };
}

function parseBudget(value: unknown): AiBudget {
  if (
    !isRecord(value) ||
    !positiveInteger(value.singleCallLimit) ||
    !positiveInteger(value.dailyTokenLimit) ||
    !positiveInteger(value.monthlyTokenLimit) ||
    !isEnum(value.limitMode, LIMIT_MODES)
  ) {
    throw new Error("AI_BUDGET_INVALID");
  }
  return {
    singleCallLimit: value.singleCallLimit,
    dailyTokenLimit: value.dailyTokenLimit,
    monthlyTokenLimit: value.monthlyTokenLimit,
    limitMode: value.limitMode,
  };
}

function parseUsage(value: unknown): AiUsage {
  if (
    !isRecord(value) ||
    !nonnegativeInteger(value.todayTokens) ||
    !nonnegativeInteger(value.monthTokens)
  ) {
    throw new Error("AI_USAGE_INVALID");
  }
  return {
    todayTokens: value.todayTokens,
    monthTokens: value.monthTokens,
  };
}

function parseCallSummary(value: unknown): AiCallSummary {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.providerName !== "string" ||
    typeof value.modelName !== "string" ||
    !isEnum(value.state, CALL_STATES) ||
    typeof value.cacheHit !== "boolean" ||
    !nonnegativeInteger(value.inputTokens) ||
    !nonnegativeInteger(value.outputTokens) ||
    !optionalString(value.errorCode) ||
    !nonnegativeInteger(value.startedAt) ||
    !optionalNonnegativeInteger(value.finishedAt)
  ) {
    throw new Error("AI_CALL_INVALID");
  }
  return {
    id: value.id,
    providerName: value.providerName,
    modelName: value.modelName,
    state: value.state,
    cacheHit: value.cacheHit,
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    errorCode: value.errorCode,
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnum<T extends string>(value: unknown, values: Set<T>): value is T {
  return typeof value === "string" && values.has(value as T);
}

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function optionalString(value: unknown): value is string | undefined {
  return value === null || value === undefined || typeof value === "string";
}

function optionalNonnegativeInteger(
  value: unknown,
): value is number | undefined {
  return value === null || value === undefined || nonnegativeInteger(value);
}
