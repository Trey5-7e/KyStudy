import { describe, expect, it } from "vitest";

import {
  normalizePlanningChatError,
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
  databasePath: "C:/private.sqlite3",
};

describe("parseConversation", () => {
  it("keeps citations without storage or call internals", () => {
    const parsed = parseConversation(CONVERSATION);
    const serialized = JSON.stringify(parsed);

    expect(parsed.messages[0]?.sources[0]?.pageNumber).toBe(3);
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
});

describe("normalizePlanningChatError", () => {
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
