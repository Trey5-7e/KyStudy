import { invoke } from "@tauri-apps/api/core";

import {
  parseAiAttachmentRef,
  type AiAttachmentRef,
} from "./aiConversationContract";
import type { AiConversationKind } from "./aiConversationContract";

function commandName(base: string, kind: AiConversationKind): string {
  if (kind !== "chat") return base;
  if (base === "list_ai_attachments") return "list_ai_chat_attachments";
  if (base === "attach_resource_to_ai_conversation") {
    return "attach_resource_to_ai_chat";
  }
  if (base === "attach_temporary_ai_attachment") {
    return "attach_temporary_ai_chat_attachment";
  }
  if (base === "retry_ai_attachment") return "retry_ai_chat_attachment";
  return "remove_ai_chat_attachment";
}

export async function listAiAttachments(
  conversationId: string,
  kind: AiConversationKind = "planning",
): Promise<AiAttachmentRef[]> {
  const value: unknown = await invoke(
    commandName("list_ai_attachments", kind),
    {
      conversationId,
    },
  );
  if (!Array.isArray(value)) {
    throw new Error("AI_ATTACHMENT_LIST_INVALID");
  }
  return value.map(parseAiAttachmentRef);
}

export async function attachResourceToAiConversation(
  conversationId: string,
  documentId: string,
  kind: AiConversationKind = "planning",
): Promise<AiAttachmentRef> {
  return parseAiAttachmentRef(
    await invoke(commandName("attach_resource_to_ai_conversation", kind), {
      request: { conversationId, documentId },
    }),
  );
}

export async function attachTemporaryAiAttachment(
  conversationId: string,
  kind: AiConversationKind = "planning",
): Promise<AiAttachmentRef | undefined> {
  const value: unknown = await invoke(
    commandName("attach_temporary_ai_attachment", kind),
    { conversationId },
  );
  if (value === null || value === undefined) {
    return undefined;
  }
  return parseAiAttachmentRef(value);
}

export async function removeAiAttachment(
  attachmentId: string,
  kind: AiConversationKind = "planning",
): Promise<void> {
  await invoke(commandName("remove_ai_attachment", kind), { attachmentId });
}

export async function retryAiAttachment(
  attachmentId: string,
  kind: AiConversationKind = "planning",
): Promise<AiAttachmentRef> {
  return parseAiAttachmentRef(
    await invoke(commandName("retry_ai_attachment", kind), { attachmentId }),
  );
}
