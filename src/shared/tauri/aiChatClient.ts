import { Channel, invoke } from "@tauri-apps/api/core";

import {
  normalizePlanningChatError,
  parseConversation,
  parsePlanningChatPreview,
  type AiChatStreamChunk,
  type PlanningChatPreview,
  type PlanningChatReply,
  type PlanningChatRequest,
  type PlanningConversation,
} from "./planningChatClient";
import { parseAiCallResult, type AiCommandError } from "./aiClient";

/** Generic chat uses the same bounded context envelope as planning chat. */
export type AiChatRequest = PlanningChatRequest;
export type AiChatPreview = PlanningChatPreview;
export type AiChatReply = PlanningChatReply;

export async function listAiChatConversations(): Promise<
  PlanningConversation[]
> {
  const value: unknown = await invoke("list_ai_chat_conversations");
  if (!Array.isArray(value)) {
    throw new Error("AI_CHAT_CONVERSATION_LIST_INVALID");
  }
  return value.map((item) => parseConversation(item, "chat"));
}

export async function createAiChatConversation(
  title: string,
): Promise<PlanningConversation> {
  return parseConversation(
    await invoke("create_ai_chat_conversation", { request: { title } }),
    "chat",
  );
}

export async function renameAiChatConversation(
  conversationId: string,
  title: string,
): Promise<PlanningConversation> {
  return parseConversation(
    await invoke("rename_ai_chat_conversation", {
      request: { conversationId, title },
    }),
    "chat",
  );
}

export async function deleteAiChatConversation(
  conversationId: string,
): Promise<void> {
  await invoke("delete_ai_chat_conversation", {
    request: { conversationId },
  });
}

export async function previewAiChat(
  request: AiChatRequest,
): Promise<AiChatPreview> {
  return parsePlanningChatPreview(await invoke("preview_ai_chat", { request }));
}

export async function executeAiChat(
  request: AiChatRequest,
  operationId = crypto.randomUUID(),
): Promise<AiChatReply> {
  const value: unknown = await invoke("execute_ai_chat", {
    request,
    operationId,
  });
  if (typeof value !== "object" || value === null) {
    throw new Error("AI_CHAT_REPLY_INVALID");
  }
  const record = value as Record<string, unknown>;
  return {
    result: parseAiCallResult(record.result),
    conversation: parseConversation(record.conversation, "chat"),
  };
}

export async function executeAiChatStream(
  request: AiChatRequest,
  onChunk?: (delta: string) => void,
  operationId = crypto.randomUUID(),
): Promise<AiChatReply> {
  const onEvent = new Channel<AiChatStreamChunk>();
  if (onChunk) {
    onEvent.onmessage = (chunk) => {
      if (typeof chunk.delta === "string") {
        onChunk(chunk.delta);
      }
    };
  }
  const value: unknown = await invoke("execute_ai_chat_stream", {
    request,
    operationId,
    onEvent,
  });
  if (typeof value !== "object" || value === null) {
    throw new Error("AI_CHAT_REPLY_INVALID");
  }
  const record = value as Record<string, unknown>;
  return {
    result: parseAiCallResult(record.result),
    conversation: parseConversation(record.conversation, "chat"),
  };
}

export function normalizeAiChatError(error: unknown): AiCommandError {
  return normalizePlanningChatError(error);
}

export { cancelAiChatOperation } from "./planningChatClient";
