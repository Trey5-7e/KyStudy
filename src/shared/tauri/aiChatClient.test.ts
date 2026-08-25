import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => {
  class MockChannel {
    onmessage?: (data: unknown) => void;
  }
  return {
    invoke: vi.fn(),
    Channel: MockChannel,
  };
});

import { executeAiChat, executeAiChatStream } from "./aiChatClient";

const mockedInvoke = vi.mocked(invoke);

const REPLY = {
  result: {
    callId: "call-id",
    responseText: "你好！",
    inputTokens: 2,
    outputTokens: 3,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    usageSource: "estimated",
    cacheHit: false,
    finishedAt: 10,
  },
  conversation: {
    id: "conversation-id",
    title: "普通对话",
    kind: "chat",
    modelProfileId: null,
    messages: [],
    createdAt: 1,
    updatedAt: 10,
  },
};

describe("generic AI chat client", () => {
  beforeEach(() => mockedInvoke.mockReset());

  it("sends the normal chat request without preview confirmation fields", async () => {
    mockedInvoke.mockResolvedValue(REPLY);
    const request = {
      conversationId: "conversation-id",
      question: "你好",
      contexts: [],
      attachmentIds: [],
      maxOutputTokens: 800,
    };

    const operationId = "019f7328-4b66-7613-9729-e3570fc41527";
    await executeAiChat(request, operationId);

    expect(mockedInvoke).toHaveBeenCalledWith("execute_ai_chat", {
      request,
      operationId,
    });
    expect(mockedInvoke.mock.calls[0]?.[1]).not.toHaveProperty(
      "request.confirmedPrompt",
    );
    expect(mockedInvoke.mock.calls[0]?.[1]).not.toHaveProperty(
      "request.confirmedRequestFingerprint",
    );
  });

  it("sends streaming request with channel event handler", async () => {
    mockedInvoke.mockImplementation(async (_cmd, args) => {
      const channel = (
        args as { onEvent?: { onmessage?: (data: unknown) => void } }
      )?.onEvent;
      channel?.onmessage?.({ delta: "你" });
      channel?.onmessage?.({ delta: "好" });
      return REPLY;
    });

    const deltas: string[] = [];
    const request = {
      conversationId: "conversation-id",
      question: "你好",
      contexts: [],
      attachmentIds: [],
      maxOutputTokens: 800,
    };

    const reply = await executeAiChatStream(request, (delta) =>
      deltas.push(delta),
    );
    expect(reply.result.responseText).toBe("你好！");
    expect(deltas).toEqual(["你", "好"]);
  });
});
