import { invoke } from "@tauri-apps/api/core";

import {
  parseAiModelCapabilities,
  type AiModelCapabilities,
} from "./aiConversationContract";

export type AiProviderType =
  | "offline_test"
  | "openai_responses"
  | "openai_chat"
  | "zhipu_chat"
  | "qwen_chat"
  | "doubao_responses"
  | "deepseek_chat"
  | "sensenova_chat"
  | "litellm_gateway";
export type AiCapabilitySelection = "supported" | "unsupported" | "unknown";
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
  capabilities: AiModelCapabilities;
  hasSecret: boolean;
  active: boolean;
}

export interface AiModelOption {
  id: string;
  ownedBy?: string;
  createdAt?: number;
}

export interface ListAiModelsRequest {
  providerId?: string;
  providerType: Exclude<AiProviderType, "offline_test">;
  baseUrl: string;
  apiKey?: string;
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
  requestFingerprint: string;
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
  "openai_chat",
  "zhipu_chat",
  "qwen_chat",
  "doubao_responses",
  "deepseek_chat",
  "sensenova_chat",
  "litellm_gateway",
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
    action: "确认该地址兼容所选 Provider 协议。",
  },
  AI_PROVIDER_REQUEST_REJECTED: {
    message: "Provider 拒绝了本次请求。",
    action: "检查模型名称和账户权限。",
  },
  AI_CALL_INTERRUPTED: {
    message: "本次 AI 对话已取消，回复未写入本地对话。",
    action: "可以重新生成预览后再发送。",
  },
  AI_MODEL_LIST_UNSUPPORTED: {
    message: "该 Provider 不提供兼容的模型列表接口。",
    action: "继续手动填写模型 ID，并通过连接测试验证。",
  },
  AI_MODEL_LIST_EMPTY: {
    message: "Provider 未返回可用模型。",
    action: "确认 API Key 权限，或手动填写模型 ID。",
  },
  AI_MODEL_LIST_INVALID: {
    message: "Provider 返回的模型列表格式无法识别。",
    action: "确认基础地址指向 API 根路径，或手动填写模型 ID。",
  },
  AI_MODEL_LIST_TOO_LARGE: {
    message: "Provider 返回的模型列表过大。",
    action: "缩小模型范围后重试，或手动填写模型 ID。",
  },
  DATABASE_BUSY: {
    message: "本地数据库正在被占用。",
    action: "关闭其他 KyStudy 窗口后重试。",
  },
  WORKSPACE_STORAGE_UNAVAILABLE: {
    message: "无法访问本地工作区存储。",
    action: "检查磁盘空间和目录权限后重试。",
  },
  SCHEMA_VERSION_UNSUPPORTED: {
    message: "这个工作区由更新版本的 KyStudy 创建。",
    action: "升级 KyStudy 后再打开该工作区。",
  },
  MIGRATION_HISTORY_INCONSISTENT: {
    message: "工作区数据库升级记录不一致。",
    action: "不要覆盖工作区文件，请保留数据并查看诊断信息。",
  },
  MIGRATION_FAILED: {
    message: "工作区数据库升级未能安全完成。",
    action: "不要覆盖工作区文件，请重启应用后重试。",
  },
  DATABASE_CONFIGURATION_UNSUPPORTED: {
    message: "本地工作区配置无法安全使用。",
    action: "重启应用；如果仍失败，请导出诊断信息。",
  },
  DATABASE_ERROR: {
    message: "本地工作区数据库读取失败。",
    action: "重启应用；如果仍失败，请导出诊断信息。",
  },
  SYSTEM_TIME_INVALID: {
    message: "系统时间暂时无法用于本地数据操作。",
    action: "校准系统时间后重试。",
  },
  INTERNAL_ERROR: {
    message: "本地 AI 任务意外中断。",
    action: "重启应用后重试。",
  },
  AI_OVERVIEW_INVALID: {
    message: "本地 AI 配置数据格式不完整。",
    action: "刷新 AI 面板；如果仍失败，进入“模型与 API”重新保存当前 Provider。",
  },
  AI_PROVIDER_INVALID: {
    message: "本地 AI Provider 配置格式不完整。",
    action: "进入“模型与 API”检查并重新保存当前 Provider。",
  },
  AI_MODEL_CAPABILITIES_INVALID: {
    message: "本地 AI 模型能力配置格式不完整。",
    action: "重新保存当前 Provider 的模型能力设置后重试。",
  },
  AI_BUDGET_INVALID: {
    message: "本地 AI 预算配置格式不完整。",
    action: "进入“模型与 API”重新保存预算设置后重试。",
  },
  AI_USAGE_INVALID: {
    message: "本地 AI 用量数据格式不完整。",
    action: "刷新 AI 面板；如果仍失败，请重启应用后重试。",
  },
  AI_CALL_INVALID: {
    message: "本地 AI 调用记录格式不完整。",
    action: "刷新 AI 面板；如果仍失败，请重启应用后重试。",
  },
  AI_PREVIEW_INVALID: {
    message: "AI 请求预览数据格式不完整。",
    action: "重新生成预览；如果仍失败，检查 Provider 协议和模型配置。",
  },
  AI_RESULT_INVALID: {
    message: "AI 回复数据格式不完整。",
    action: "重试当前请求；如果仍失败，检查 Provider 是否返回兼容格式。",
  },
  AI_HISTORY_INVALID: {
    message: "AI 分析历史数据格式不完整。",
    action: "刷新当前页面后重试；如果仍失败，请重启应用。",
  },
  AI_CHAT_REPLY_INVALID: {
    message: "AI 对话响应数据格式不完整。",
    action: "重试当前请求；如果仍失败，检查 Provider 是否返回兼容格式。",
  },
  AI_CHAT_CONVERSATION_LIST_INVALID: {
    message: "AI 对话列表数据格式不完整。",
    action: "刷新 AI 对话页面；如果仍失败，请重启应用。",
  },
  AI_CHAT_CONVERSATION_KIND_INVALID: {
    message: "AI 对话类型数据不匹配。",
    action: "刷新对话列表后重试；必要时新建一段对话。",
  },
  PLANNING_CONVERSATION_LIST_INVALID: {
    message: "规划对话列表数据格式不完整。",
    action: "刷新规划对话页面；如果仍失败，请重启应用。",
  },
  PLANNING_CONVERSATION_INVALID: {
    message: "规划对话数据格式不完整。",
    action: "刷新当前对话；如果仍失败，请新建一段对话。",
  },
  PLANNING_CONVERSATION_KIND_INVALID: {
    message: "规划对话类型数据不匹配。",
    action: "刷新对话列表后重试；必要时新建一段规划对话。",
  },
  PLANNING_CONVERSATION_MODEL_INVALID: {
    message: "规划对话模型配置格式不完整。",
    action: "进入“模型与 API”检查当前 Provider 后重试。",
  },
  PLANNING_MESSAGE_INVALID: {
    message: "规划对话消息数据格式不完整。",
    action: "刷新当前对话；如果仍失败，请新建一段对话。",
  },
  PLANNING_SOURCE_INVALID: {
    message: "规划对话资料引用格式不完整。",
    action: "刷新资料索引后重试，或移除失效资料。",
  },
  PLANNING_CHAT_PREVIEW_INVALID: {
    message: "规划对话预览数据格式不完整。",
    action: "重新生成预览；如果仍失败，检查 Provider 协议和资料上下文。",
  },
  PLANNING_CHAT_REPLY_INVALID: {
    message: "规划对话响应数据格式不完整。",
    action: "重试当前请求；如果仍失败，检查 Provider 是否返回兼容格式。",
  },
  PLANNING_DRAFT_RESULT_INVALID: {
    message: "规划草稿结果数据格式不完整。",
    action: "刷新规划对话后重新保存草稿。",
  },
  PLANNING_ATTACHMENT_PREVIEW_INVALID: {
    message: "对话资料预览数据格式不完整。",
    action: "刷新资料列表后重新添加资料。",
  },
  AI_ATTACHMENT_INVALID: {
    message: "AI 对话资料元数据格式不完整。",
    action: "移除并重新添加这份资料。",
  },
  AI_ATTACHMENT_LIST_INVALID: {
    message: "AI 对话资料列表数据格式不完整。",
    action: "刷新当前对话后重试。",
  },
  AI_CHAT_CANCEL_INVALID: {
    message: "AI 对话取消结果格式不完整。",
    action: "刷新当前对话后重试。",
  },
  PLANNING_CHAT_INPUT_INVALID: {
    message: "规划对话输入无效。",
    action: "检查问题、资料范围和输出上限后重试。",
  },
  PLANNING_CONVERSATION_NOT_FOUND: {
    message: "找不到这段规划对话。",
    action: "刷新列表或新建对话后重试。",
  },
  PLANNING_CONTEXT_NOT_FOUND: {
    message: "选中的资料页没有可用文字片段。",
    action: "重新建立资料索引，或选择其他正文搜索结果。",
  },
  PLANNING_PREVIEW_STALE: {
    message: "资料或对话已经变化，本次确认已失效。",
    action: "重新生成外发预览并核对完整内容。",
  },
  PLANNING_REPLY_NOT_FOUND: {
    message: "找不到可保存的 AI 回复。",
    action: "刷新对话后重新选择助手回复。",
  },
  AI_ATTACHMENT_NOT_FOUND: {
    message: "找不到这条对话资料。",
    action: "刷新当前对话后重试。",
  },
  AI_ATTACHMENT_LIMIT_REACHED: {
    message: "当前对话最多绑定 6 份资料。",
    action: "移除不再需要的资料后再添加。",
  },
  AI_ATTACHMENT_RESOURCE_NOT_FOUND: {
    message: "这份本地资料已不存在或尚未准备好。",
    action: "刷新资料库并选择可用资料。",
  },
  AI_ATTACHMENT_TEMPORARY_FAILED: {
    message: "临时资料未能安全保存。",
    action: "检查磁盘空间和资料权限后重新选择。",
  },
  AI_ATTACHMENT_TEMPORARY_NOT_FOUND: {
    message: "临时资料已丢失或被外部修改。",
    action: "重新选择电脑资料，或从资料库重新添加。",
  },
  AI_ATTACHMENT_TOO_LARGE: {
    message: "临时资料超过 100 MiB 限制。",
    action: "选择更小的资料，或先导入资料库并建立本地索引。",
  },
  AI_ATTACHMENT_NATIVE_TOO_LARGE: {
    message: "电脑资料超过原生 Provider 的 24 MiB 上传限制。",
    action: "选择更小的资料，或先导入资料库并建立本地索引。",
  },
  AI_ATTACHMENT_NOT_INDEXED: {
    message: "本地资料尚未建立可用的文本索引。",
    action: "等待资料索引完成或重新导入后再发送。",
  },
  PLANNING_CHAT_CANCELED: {
    message: "本次 AI 对话已取消，回复未写入本地对话。",
    action: "重新生成预览后再发送。",
  },
};

export async function getAiOverview(): Promise<AiOverview> {
  return parseAiOverview(await invoke("get_ai_overview"));
}

export async function listAiModels(
  request: ListAiModelsRequest,
): Promise<AiModelOption[]> {
  return parseAiModelOptions(
    await invoke("list_ai_models", {
      request: {
        providerId: request.providerId,
        providerType: request.providerType,
        baseUrl: request.baseUrl,
        ...(request.apiKey === undefined || request.apiKey.trim() === ""
          ? {}
          : { apiKey: request.apiKey }),
      },
    }),
  );
}

export interface SaveAiProviderRequest {
  providerType: AiProviderType;
  displayName: string;
  baseUrl?: string;
  modelName: string;
  contextLimit: number;
  maxOutputTokens: number;
}

export interface SaveAiProviderCapabilitiesRequest {
  supportsImage: AiCapabilitySelection;
  supportsFile: AiCapabilitySelection;
  supportsPdf: AiCapabilitySelection;
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

export async function saveAiProviderCapabilities(
  providerId: string,
  request: SaveAiProviderCapabilitiesRequest,
): Promise<AiOverview> {
  return parseAiOverview(
    await invoke("save_ai_provider_capabilities", {
      providerId,
      request,
    }),
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

export interface QuestionAiAnalysisHistoryEntry {
  sourceFingerprint: string;
  result: AiCallResult;
}

export async function previewQuestionAiAnalysis(
  request: QuestionAiAnalysisRequest,
): Promise<AiCallPreview> {
  return parseAiCallPreview(
    await invoke("preview_question_ai_analysis", { request }),
  );
}

export async function executeQuestionAiAnalysis(
  questionId: string,
  sourceFingerprint: string,
  request: QuestionAiAnalysisRequest,
  forceRefresh = false,
): Promise<AiCallResult> {
  return parseAiCallResult(
    await invoke("execute_question_ai_analysis", {
      request: {
        questionId,
        sourceFingerprint,
        ...request,
        forceRefresh,
      },
    }),
  );
}

export async function getQuestionAiAnalysis(
  questionId: string,
  sourceFingerprint: string,
): Promise<AiCallResult | undefined> {
  const value = await invoke("get_question_ai_analysis", {
    request: { questionId, sourceFingerprint },
  });
  return value === null || value === undefined
    ? undefined
    : parseAiCallResult(value);
}

export async function listQuestionAiAnalysisHistory(
  questionId: string,
): Promise<QuestionAiAnalysisHistoryEntry[]> {
  return parseQuestionAiAnalysisHistory(
    await invoke("list_question_ai_analysis_history", {
      request: { questionId },
    }),
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

export function parseAiModelOptions(value: unknown): AiModelOption[] {
  let entries: unknown[];
  if (Array.isArray(value)) {
    entries = value;
  } else if (isRecord(value)) {
    if (
      typeof value.object === "string" &&
      value.object.toLowerCase() !== "list"
    ) {
      throw new Error("AI_MODEL_LIST_INVALID");
    }
    if (!Array.isArray(value.data)) {
      throw new Error("AI_MODEL_LIST_INVALID");
    }
    entries = value.data;
  } else {
    throw new Error("AI_MODEL_LIST_INVALID");
  }

  const seen = new Set<string>();
  const models: AiModelOption[] = [];
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      throw new Error("AI_MODEL_LIST_INVALID");
    }
    const id = entry.id.trim();
    if (id.length === 0 || id.length > 120 || seen.has(id)) {
      if (id.length === 0 || id.length > 120) {
        throw new Error("AI_MODEL_LIST_INVALID");
      }
      continue;
    }
    const ownedBy = entry.ownedBy ?? entry.owned_by;
    const createdAt = entry.createdAt ?? entry.created;
    if (!optionalString(ownedBy) || !optionalNonnegativeInteger(createdAt)) {
      throw new Error("AI_MODEL_LIST_INVALID");
    }
    seen.add(id);
    models.push({
      id,
      ownedBy,
      createdAt,
    });
  }
  models.sort((left, right) => {
    const leftId = left.id.toLowerCase();
    const rightId = right.id.toLowerCase();
    if (leftId < rightId) return -1;
    if (leftId > rightId) return 1;
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    return 0;
  });
  return models;
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
    typeof value.requestFingerprint !== "string" ||
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
    requestFingerprint: value.requestFingerprint,
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

export function parseQuestionAiAnalysisHistory(
  value: unknown,
): QuestionAiAnalysisHistoryEntry[] {
  if (!Array.isArray(value)) {
    throw new Error("AI_HISTORY_INVALID");
  }
  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.sourceFingerprint !== "string" ||
      !("result" in entry)
    ) {
      throw new Error("AI_HISTORY_INVALID");
    }
    return {
      sourceFingerprint: entry.sourceFingerprint,
      result: parseAiCallResult(entry.result),
    };
  });
}

export function normalizeAiError(error: unknown): AiCommandError {
  const errorCode = extractAiErrorCode(error);
  if (errorCode !== undefined) {
    const copy = ERROR_COPY[errorCode];
    return {
      code: errorCode,
      ...(copy ?? {
        message: "本地 AI 返回了无法识别的数据。",
        action: "刷新当前页面；如果仍失败，请重启应用后重试。",
      }),
      operationId:
        isRecord(error) && typeof error.operationId === "string"
          ? error.operationId
          : undefined,
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

function extractAiErrorCode(error: unknown): string | undefined {
  const candidate =
    error instanceof Error
      ? error.message
      : isRecord(error) && typeof error.code === "string"
        ? error.code
        : undefined;
  if (
    candidate === undefined ||
    (!/^AI_[A-Z0-9_]{2,80}$/.test(candidate) &&
      !/^PLANNING_[A-Z0-9_]{2,80}$/.test(candidate))
  ) {
    return undefined;
  }
  return candidate;
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
  const capabilities = parseAiModelCapabilities(
    value.capabilities ?? {
      supportsImage: value.supportsImage ?? "unknown",
      supportsFile: value.supportsFile ?? "unknown",
      supportsPdf: value.supportsPdf ?? "unknown",
      capabilitySource: value.capabilitySource ?? "unknown",
    },
  );
  return {
    id: value.id,
    providerType: value.providerType,
    displayName: value.displayName,
    baseUrl: value.baseUrl,
    modelName: value.modelName,
    contextLimit: value.contextLimit,
    maxOutputTokens: value.maxOutputTokens,
    capabilities,
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
