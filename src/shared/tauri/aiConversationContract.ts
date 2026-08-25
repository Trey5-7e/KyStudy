export const AI_CONVERSATION_KINDS = ["planning", "chat"] as const;

export type AiConversationKind = (typeof AI_CONVERSATION_KINDS)[number];

export type AiMessageRole = "user" | "assistant";

export type AiCapabilityState = boolean | "unknown";
export type AiCapabilitySource = "manual" | "tested" | "unknown";

export interface AiModelCapabilities {
  supportsImage: AiCapabilityState;
  supportsFile: AiCapabilityState;
  supportsPdf: AiCapabilityState;
  capabilitySource: AiCapabilitySource;
}

export type AiAttachmentSource = "resource" | "temporary";
export type AiAttachmentStatus = "ready" | "processing" | "expired" | "failed";

export interface AiAttachmentRef {
  id: string;
  conversationId: string;
  source: AiAttachmentSource;
  documentId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
  status: AiAttachmentStatus;
  errorCode?: string;
  createdAt: number;
  updatedAt: number;
}

export function parseAiModelCapabilities(value: unknown): AiModelCapabilities {
  if (!isRecord(value)) {
    throw new Error("AI_MODEL_CAPABILITIES_INVALID");
  }
  return {
    supportsImage: parseCapabilityState(value.supportsImage),
    supportsFile: parseCapabilityState(value.supportsFile),
    supportsPdf: parseCapabilityState(value.supportsPdf),
    capabilitySource: parseCapabilitySource(value.capabilitySource),
  };
}

export function parseAiAttachmentRef(value: unknown): AiAttachmentRef {
  const sizeBytes = isRecord(value) ? value.sizeBytes : undefined;
  const createdAt = isRecord(value) ? value.createdAt : undefined;
  const updatedAt = isRecord(value) ? value.updatedAt : undefined;
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.conversationId !== "string" ||
    !isAttachmentSource(value.source) ||
    typeof value.fileName !== "string" ||
    typeof value.mimeType !== "string" ||
    !isNonnegativeInteger(sizeBytes) ||
    sizeBytes > 104_857_600 ||
    !isAttachmentStatus(value.status) ||
    !isNonnegativeInteger(createdAt) ||
    !isNonnegativeInteger(updatedAt) ||
    updatedAt < createdAt
  ) {
    throw new Error("AI_ATTACHMENT_INVALID");
  }
  // Rust's `Option<T>` fields serialize as JSON `null` by default. Treat
  // null and an omitted optional field identically so temporary attachments
  // returned by the native command satisfy the same contract as hand-built
  // test fixtures.
  const documentId = value.documentId === null ? undefined : value.documentId;
  const sha256 = value.sha256 === null ? undefined : value.sha256;
  const errorCode = value.errorCode === null ? undefined : value.errorCode;
  if (
    (value.source === "resource" && typeof documentId !== "string") ||
    (value.source === "temporary" && documentId !== undefined) ||
    (sha256 !== undefined &&
      (typeof sha256 !== "string" || sha256.length !== 64)) ||
    (value.status === "failed" && typeof errorCode !== "string") ||
    (value.status !== "failed" && errorCode !== undefined)
  ) {
    throw new Error("AI_ATTACHMENT_INVALID");
  }
  return {
    id: value.id,
    conversationId: value.conversationId,
    source: value.source,
    documentId: typeof documentId === "string" ? documentId : undefined,
    fileName: value.fileName,
    mimeType: value.mimeType,
    sizeBytes,
    sha256: typeof sha256 === "string" ? sha256 : undefined,
    status: value.status,
    errorCode: typeof errorCode === "string" ? errorCode : undefined,
    createdAt,
    updatedAt,
  };
}

function parseCapabilityState(value: unknown): AiCapabilityState {
  if (typeof value === "boolean" || value === "unknown") {
    return value;
  }
  throw new Error("AI_MODEL_CAPABILITIES_INVALID");
}

function parseCapabilitySource(value: unknown): AiCapabilitySource {
  if (value === "manual" || value === "tested" || value === "unknown") {
    return value;
  }
  throw new Error("AI_MODEL_CAPABILITIES_INVALID");
}

function isAttachmentSource(value: unknown): value is AiAttachmentSource {
  return value === "resource" || value === "temporary";
}

function isAttachmentStatus(value: unknown): value is AiAttachmentStatus {
  return (
    value === "ready" ||
    value === "processing" ||
    value === "expired" ||
    value === "failed"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Shared envelope for every persisted AI conversation. */
export interface AiConversation {
  id: string;
  title: string;
  kind: AiConversationKind;
  modelProfileId?: string;
  messages: AiConversationMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AiConversationMessage {
  id: string;
  role: AiMessageRole;
  content: string;
  createdAt: number;
}

export function parseAiConversationKind(value: unknown): AiConversationKind {
  if (value === "planning" || value === "chat") {
    return value;
  }
  throw new Error("AI_CONVERSATION_KIND_INVALID");
}
