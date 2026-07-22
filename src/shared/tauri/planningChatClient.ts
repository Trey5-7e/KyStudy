import { invoke } from "@tauri-apps/api/core";

import {
  normalizeAiError,
  parseAiCallPreview,
  parseAiCallResult,
  type AiCallPreview,
  type AiCallResult,
  type AiCommandError,
} from "./aiClient";

export interface PlanningContextSelection {
  documentId: string;
  pageNumber: number;
  searchQuery: string;
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
  messages: PlanningMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface PlanningChatRequest {
  conversationId: string;
  question: string;
  contexts: PlanningContextSelection[];
  maxOutputTokens: number;
}

export interface PlanningChatPreview {
  preview: AiCallPreview;
  sources: PlanningSource[];
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
};

export async function listPlanningConversations(): Promise<
  PlanningConversation[]
> {
  const value: unknown = await invoke("list_planning_conversations");
  if (!Array.isArray(value)) {
    throw new Error("PLANNING_CONVERSATION_LIST_INVALID");
  }
  return value.map(parseConversation);
}

export async function createPlanningConversation(
  title: string,
): Promise<PlanningConversation> {
  return parseConversation(
    await invoke("create_planning_conversation", { request: { title } }),
  );
}

export async function previewPlanningChat(
  request: PlanningChatRequest,
): Promise<PlanningChatPreview> {
  const value: unknown = await invoke("preview_planning_chat", { request });
  if (!isRecord(value) || !Array.isArray(value.sources)) {
    throw new Error("PLANNING_CHAT_PREVIEW_INVALID");
  }
  return {
    preview: parseAiCallPreview(value.preview),
    sources: value.sources.map(parseSource),
  };
}

export async function executePlanningChat(
  request: PlanningChatRequest & { confirmedPrompt: string },
): Promise<PlanningChatReply> {
  const value: unknown = await invoke("execute_planning_chat", { request });
  if (!isRecord(value)) {
    throw new Error("PLANNING_CHAT_REPLY_INVALID");
  }
  return {
    result: parseAiCallResult(value.result),
    conversation: parseConversation(value.conversation),
  };
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

export function parseConversation(value: unknown): PlanningConversation {
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
  return {
    id: value.id,
    title: value.title,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}
