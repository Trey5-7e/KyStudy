import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => {
  class MockChannel {
    onmessage?: (data: unknown) => void;
  }
  return {
    invoke: vi.fn(),
    Channel: MockChannel,
  };
});

import {
  executePlanningChatStream,
  normalizePlanningChatError,
  parsePlanningChatPreview,
  parseConversation,
} from "./planningChatClient";

const CONVERSATION = {
  id: "conversation-id",
  title: "规划讨论",
  messages: [
    {
      id: "message-id",
      role: "assistant",
      content: "建议先完成基础阶段。[资料1]",
      sources: [
        {
          documentId: "document-id",
          documentTitle: "经验资料.pdf",
          pageNumber: 3,
          citationLabel: "[资料1]",
          contentHash: "private-hash",
        },
      ],
      createdAt: 1,
      aiCallId: "private-call-id",
    },
  ],
  createdAt: 1,
  updatedAt: 2,
  kind: "planning",
  modelProfileId: "model-profile-id",
  databasePath: "C:/private.sqlite3",
};

describe("parseConversation", () => {
  it("keeps citations without storage or call internals", () => {
    const parsed = parseConversation(CONVERSATION);
    const serialized = JSON.stringify(parsed);

    expect(parsed.messages[0]?.sources[0]?.pageNumber).toBe(3);
    expect(parsed.modelProfileId).toBe("model-profile-id");
    expect(serialized).not.toContain("contentHash");
    expect(serialized).not.toContain("aiCallId");
    expect(serialized).not.toContain("databasePath");
  });

  it("rejects an unknown message role", () => {
    expect(() =>
      parseConversation({
        ...CONVERSATION,
        messages: [{ ...CONVERSATION.messages[0], role: "system" }],
      }),
    ).toThrowError("PLANNING_MESSAGE_INVALID");
  });

  it("rejects a conversation from the generic chat surface", () => {
    expect(() =>
      parseConversation({ ...CONVERSATION, kind: "chat" }),
    ).toThrowError("PLANNING_CONVERSATION_KIND_INVALID");
  });

  it("accepts a chat conversation only when the chat parser opts in", () => {
    const parsed = parseConversation({ ...CONVERSATION, kind: "chat" }, "chat");

    expect(parsed.kind).toBe("chat");
  });

  it("rejects a malformed model override", () => {
    expect(() =>
      parseConversation({ ...CONVERSATION, modelProfileId: 42 }),
    ).toThrowError("PLANNING_CONVERSATION_MODEL_INVALID");
  });

  it("accepts a null model override from legacy conversations", () => {
    const parsed = parseConversation({ ...CONVERSATION, modelProfileId: null });

    expect(parsed.modelProfileId).toBeUndefined();
  });
});

describe("normalizePlanningChatError", () => {
  it("normalizes an interrupted chat without exposing provider details", () => {
    const error = normalizePlanningChatError({
      code: "PLANNING_CHAT_CANCELED",
      message: "provider body with sk-private",
    });

    expect(error.code).toBe("PLANNING_CHAT_CANCELED");
    expect(error.message).toContain("取消");
    expect(JSON.stringify(error)).not.toContain("sk-private");
  });

  it("does not expose a raw provider response", () => {
    const error = normalizePlanningChatError({
      code: "AI_PROVIDER_UNAVAILABLE",
      message: "raw body with sk-private",
      action: "SELECT * FROM ai_message",
    });

    expect(JSON.stringify(error)).not.toContain("sk-private");
    expect(JSON.stringify(error)).not.toContain("SELECT");
  });
});

describe("parsePlanningChatPreview", () => {
  const basePreview = {
    providerName: "Offline",
    providerType: "offline_test",
    modelName: "offline-model",
    destination: "local",
    prompt: "question",
    inputTokenEstimate: 10,
    outputTokenLimit: 100,
    projectedTokens: 110,
    todayTokens: 0,
    monthTokens: 0,
    allowed: true,
    warnings: [],
    requestFingerprint: "fingerprint",
  };

  it("parses local-text attachment diagnostics", () => {
    const parsed = parsePlanningChatPreview({
      preview: basePreview,
      sources: [],
      transport: "local_text",
      attachments: [
        {
          id: "attachment-id",
          fileName: "notes.pdf",
          transport: "local_text",
          indexedPages: 3,
          warning: "降级为本地文本",
        },
      ],
    });

    expect(parsed.transport).toBe("local_text");
    expect(parsed.attachments[0]?.indexedPages).toBe(3);
    expect(parsed.attachments[0]?.warning).toBe("降级为本地文本");
  });

  it("keeps legacy previews compatible", () => {
    const parsed = parsePlanningChatPreview({
      preview: basePreview,
      sources: [],
    });
    expect(parsed.transport).toBe("none");
    expect(parsed.attachments).toEqual([]);
  });

  it("rejects an unknown transport mode", () => {
    expect(() =>
      parsePlanningChatPreview({
        preview: basePreview,
        sources: [],
        transport: "remote_upload",
        attachments: [],
      }),
    ).toThrowError("PLANNING_CHAT_PREVIEW_INVALID");
  });

  it("executes planning chat stream with chunks", async () => {
    const mockedInvoke = vi.mocked(invoke);
    mockedInvoke.mockImplementation(async (_cmd, args) => {
      const channel = (
        args as { onEvent?: { onmessage?: (data: unknown) => void } }
      )?.onEvent;
      channel?.onmessage?.({ delta: "规划" });
      channel?.onmessage?.({ delta: "建议" });
      return {
        result: {
          callId: "call-id",
          responseText: "规划建议",
          inputTokens: 10,
          outputTokens: 20,
          cachedInputTokens: 0,
          reasoningTokens: 0,
          usageSource: "estimated",
          cacheHit: false,
          finishedAt: 10,
        },
        conversation: CONVERSATION,
      };
    });

    const deltas: string[] = [];
    const reply = await executePlanningChatStream(
      {
        conversationId: "conversation-id",
        question: "如何规划？",
        contexts: [],
        attachmentIds: [],
        maxOutputTokens: 1000,
        confirmedPrompt: "确认 Prompt",
        confirmedRequestFingerprint: "fingerprint",
      },
      (delta) => deltas.push(delta),
    );

    expect(reply.result.responseText).toBe("规划建议");
    expect(deltas).toEqual(["规划", "建议"]);
  });
});
