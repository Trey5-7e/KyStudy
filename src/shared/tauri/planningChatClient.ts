import { Channel, invoke } from "@tauri-apps/api/core";

import {
  normalizeAiError,
  parseAiCallPreview,
  parseAiCallResult,
  type AiCallPreview,
  type AiCallResult,
  type AiCommandError,
} from "./aiClient";
import {
  parseAiConversationKind,
  type AiConversationKind,
} from "./aiConversationContract";

export interface PlanningContextSelection {
  documentId: string;
  pageNumber: number;
  searchQuery: string;
}

export interface PlanningQuestionContext {
  title: string;
  documentTitle: string;
  analysis?: string;
  imageDataUrls: string[];
}

export interface PlanningSource {
  documentId: string;
  documentTitle: string;
  pageNumber: number;
  citationLabel: string;
}

export interface PlanningMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: PlanningSource[];
  createdAt: number;
}

export interface PlanningConversation {
  id: string;
  title: string;
  kind: AiConversationKind;
  modelProfileId?: string;
  messages: PlanningMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface PlanningChatRequest {
  conversationId: string;
  question: string;
  contexts: PlanningContextSelection[];
  questionContext?: PlanningQuestionContext;
  attachmentIds: string[];
  imageDataUrls?: string[];
  maxOutputTokens: number;
}

export type PlanningTransportMode =
  "none" | "native_file" | "local_text" | "local_text_image" | "mixed";

export interface PlanningAttachmentPreview {
  id: string;
  fileName: string;
  transport: PlanningTransportMode;
  indexedPages?: number;
  warning?: string;
}

export interface PlanningChatPreview {
  preview: AiCallPreview;
  sources: PlanningSource[];
  transport: PlanningTransportMode;
  attachments: PlanningAttachmentPreview[];
}

export interface PlanningChatReply {
  result: AiCallResult;
  conversation: PlanningConversation;
}

const ERROR_COPY: Record<string, { message: string; action: string }> = {
  PLANNING_CHAT_INPUT_INVALID: {
    message: "规划问题、资料范围或输出上限无效。",
    action: "最多选择 6 个页码，并检查问题和 Token 上限后重试。",
  },
  PLANNING_CONVERSATION_NOT_FOUND: {
    message: "找不到这段规划对话。",
    action: "刷新列表或新建对话后重试。",
  },
  PLANNING_CONTEXT_NOT_FOUND: {
    message: "选中的资料页没有可用文字片段。",
    action: "重新建立 PDF 文字索引，或选择其他正文搜索结果。",
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
    message: "找不到这条对话附件。",
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
  AI_ATTACHMENT_INVALID: {
    message: "本地资料元数据不符合附件要求。",
    action: "选择完整性校验通过且不超过 100 MiB 的资料。",
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
    message: "鏈湴璧勬枡灏氭湭寤虹珛鍙敤鐨勬枃鏈储寮曘€?",
    action: "绛夊緟璧勬枡绱㈠紩瀹屾垚鎴栭噸鏂板鍏ュ悗鍐嶅彂閫併€?",
  },
  PLANNING_CHAT_CANCELED: {
    message: "本次 AI 对话已取消，回复未写入本地对话。",
    action: "可以重新生成预览后再发送。",
  },
};

export async function listPlanningConversations(): Promise<
  PlanningConversation[]
> {
  const value: unknown = await invoke("list_planning_conversations");
  if (!Array.isArray(value)) {
    throw new Error("PLANNING_CONVERSATION_LIST_INVALID");
  }
  return value.map((item) => parseConversation(item, "planning"));
}

export async function createPlanningConversation(
  title: string,
): Promise<PlanningConversation> {
  return parseConversation(
    await invoke("create_planning_conversation", { request: { title } }),
    "planning",
  );
}

export async function renamePlanningConversation(
  conversationId: string,
  title: string,
): Promise<PlanningConversation> {
  return parseConversation(
    await invoke("rename_planning_conversation", {
      request: { conversationId, title },
    }),
    "planning",
  );
}

export async function deletePlanningConversation(
  conversationId: string,
): Promise<void> {
  await invoke("delete_planning_conversation", {
    request: { conversationId },
  });
}

export async function previewPlanningChat(
  request: PlanningChatRequest,
): Promise<PlanningChatPreview> {
  return parsePlanningChatPreview(
    await invoke("preview_planning_chat", { request }),
  );
}

export function parsePlanningChatPreview(value: unknown): PlanningChatPreview {
  if (!isRecord(value) || !Array.isArray(value.sources)) {
    throw new Error("PLANNING_CHAT_PREVIEW_INVALID");
  }
  return {
    preview: parseAiCallPreview(value.preview),
    sources: value.sources.map(parseSource),
    transport: parseTransport(value.transport ?? "none"),
    attachments: Array.isArray(value.attachments)
      ? value.attachments.map(parseAttachmentPreview)
      : [],
  };
}

export async function executePlanningChat(
  request: PlanningChatRequest & {
    confirmedPrompt: string;
    confirmedRequestFingerprint: string;
  },
  operationId = crypto.randomUUID(),
): Promise<PlanningChatReply> {
  const value: unknown = await invoke("execute_planning_chat", {
    request,
    operationId,
  });
  if (!isRecord(value)) {
    throw new Error("PLANNING_CHAT_REPLY_INVALID");
  }
  return {
    result: parseAiCallResult(value.result),
    conversation: parseConversation(value.conversation, "planning"),
  };
}

export interface AiChatStreamChunk {
  delta: string;
}

export async function executePlanningChatStream(
  request: PlanningChatRequest & {
    confirmedPrompt: string;
    confirmedRequestFingerprint: string;
  },
  onChunk?: (delta: string) => void,
  operationId = crypto.randomUUID(),
): Promise<PlanningChatReply> {
  const onEvent = new Channel<AiChatStreamChunk>();
  if (onChunk) {
    onEvent.onmessage = (chunk) => {
      if (typeof chunk.delta === "string") {
        onChunk(chunk.delta);
      }
    };
  }
  const value: unknown = await invoke("execute_planning_chat_stream", {
    request,
    operationId,
    onEvent,
  });
  if (!isRecord(value)) {
    throw new Error("PLANNING_CHAT_REPLY_INVALID");
  }
  return {
    result: parseAiCallResult(value.result),
    conversation: parseConversation(value.conversation, "planning"),
  };
}

export async function cancelAiChatOperation(
  operationId: string,
): Promise<boolean> {
  const value: unknown = await invoke("cancel_ai_chat", { operationId });
  if (typeof value !== "boolean") {
    throw new Error("AI_CHAT_CANCEL_INVALID");
  }
  return value;
}

export async function savePlanningReplyAsDraft(
  messageId: string,
  title: string,
): Promise<string> {
  const value: unknown = await invoke("save_planning_reply_as_draft", {
    request: { messageId, title },
  });
  if (!isRecord(value) || typeof value.planId !== "string") {
    throw new Error("PLANNING_DRAFT_RESULT_INVALID");
  }
  return value.planId;
}

export function normalizePlanningChatError(error: unknown): AiCommandError {
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
  return normalizeAiError(error);
}

export function parseConversation(
  value: unknown,
  expectedKind: AiConversationKind = "planning",
): PlanningConversation {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    !Array.isArray(value.messages) ||
    !isNonNegativeInteger(value.createdAt) ||
    !isNonNegativeInteger(value.updatedAt)
  ) {
    throw new Error("PLANNING_CONVERSATION_INVALID");
  }
  const kind =
    value.kind === undefined ? "planning" : parseAiConversationKind(value.kind);
  if (kind !== expectedKind) {
    throw new Error(
      expectedKind === "planning"
        ? "PLANNING_CONVERSATION_KIND_INVALID"
        : "AI_CHAT_CONVERSATION_KIND_INVALID",
    );
  }
  if (
    value.modelProfileId !== undefined &&
    value.modelProfileId !== null &&
    typeof value.modelProfileId !== "string"
  ) {
    throw new Error("PLANNING_CONVERSATION_MODEL_INVALID");
  }
  const modelProfileId =
    typeof value.modelProfileId === "string" ? value.modelProfileId : undefined;
  return {
    id: value.id,
    title: value.title,
    kind,
    modelProfileId,
    messages: value.messages.map(parseMessage),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseMessage(value: unknown): PlanningMessage {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !["user", "assistant"].includes(
      typeof value.role === "string" ? value.role : "",
    ) ||
    typeof value.content !== "string" ||
    !Array.isArray(value.sources) ||
    !isNonNegativeInteger(value.createdAt)
  ) {
    throw new Error("PLANNING_MESSAGE_INVALID");
  }
  return {
    id: value.id,
    role: value.role as PlanningMessage["role"],
    content: value.content,
    sources: value.sources.map(parseSource),
    createdAt: value.createdAt,
  };
}

function parseSource(value: unknown): PlanningSource {
  if (
    !isRecord(value) ||
    typeof value.documentId !== "string" ||
    typeof value.documentTitle !== "string" ||
    !isPositiveInteger(value.pageNumber) ||
    typeof value.citationLabel !== "string"
  ) {
    throw new Error("PLANNING_SOURCE_INVALID");
  }
  return {
    documentId: value.documentId,
    documentTitle: value.documentTitle,
    pageNumber: value.pageNumber,
    citationLabel: value.citationLabel,
  };
}

function parseAttachmentPreview(value: unknown): PlanningAttachmentPreview {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.fileName !== "string" ||
    !isTransport(value.transport) ||
    (value.indexedPages !== undefined &&
      !isPositiveInteger(value.indexedPages)) ||
    (value.warning !== undefined && typeof value.warning !== "string")
  ) {
    throw new Error("PLANNING_ATTACHMENT_PREVIEW_INVALID");
  }
  return {
    id: value.id,
    fileName: value.fileName,
    transport: value.transport,
    indexedPages: value.indexedPages,
    warning: value.warning,
  };
}

function parseTransport(value: unknown): PlanningTransportMode {
  if (!isTransport(value)) {
    throw new Error("PLANNING_CHAT_PREVIEW_INVALID");
  }
  return value;
}

function isTransport(value: unknown): value is PlanningTransportMode {
  return (
    value === "none" ||
    value === "native_file" ||
    value === "local_text" ||
    value === "local_text_image" ||
    value === "mixed"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}
