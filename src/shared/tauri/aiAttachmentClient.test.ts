import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  attachResourceToAiConversation,
  attachTemporaryAiAttachment,
  listAiAttachments,
  removeAiAttachment,
  retryAiAttachment,
} from "./aiAttachmentClient";

const mockedInvoke = vi.mocked(invoke);

const ATTACHMENT = {
  id: "019f7328-4b66-7613-9729-e3570fc41528",
  conversationId: "019f7328-4b66-7613-9729-e3570fc41527",
  source: "resource",
  documentId: "019f7328-4b66-7613-9729-e3570fc41525",
  fileName: "context.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1024,
  sha256: "0".repeat(64),
  status: "ready",
  createdAt: 1,
  updatedAt: 1,
};

const TEMPORARY_ATTACHMENT = {
  ...ATTACHMENT,
  source: "temporary",
  documentId: null,
  sha256: null,
};

describe("AI attachment client", () => {
  beforeEach(() => mockedInvoke.mockReset());

  it("parses the attachment list returned by the backend", async () => {
    mockedInvoke.mockResolvedValue([ATTACHMENT]);

    const attachments = await listAiAttachments(ATTACHMENT.conversationId);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject(ATTACHMENT);
    expect(mockedInvoke).toHaveBeenCalledWith("list_ai_attachments", {
      conversationId: ATTACHMENT.conversationId,
    });
  });

  it("sends a resource binding request and supports removal", async () => {
    mockedInvoke
      .mockResolvedValueOnce(ATTACHMENT)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ATTACHMENT);

    await attachResourceToAiConversation(
      ATTACHMENT.conversationId,
      ATTACHMENT.documentId,
    );
    await removeAiAttachment(ATTACHMENT.id);
    await retryAiAttachment(ATTACHMENT.id);

    expect(mockedInvoke.mock.calls).toEqual([
      [
        "attach_resource_to_ai_conversation",
        {
          request: {
            conversationId: ATTACHMENT.conversationId,
            documentId: ATTACHMENT.documentId,
          },
        },
      ],
      ["remove_ai_attachment", { attachmentId: ATTACHMENT.id }],
      ["retry_ai_attachment", { attachmentId: ATTACHMENT.id }],
    ]);
  });

  it("returns no attachment when the native picker is canceled", async () => {
    mockedInvoke.mockResolvedValue(null);

    await expect(
      attachTemporaryAiAttachment(ATTACHMENT.conversationId),
    ).resolves.toBeUndefined();
    expect(mockedInvoke).toHaveBeenCalledWith(
      "attach_temporary_ai_attachment",
      {
        conversationId: ATTACHMENT.conversationId,
      },
    );
  });

  it("maps temporary attachment commands for the chat conversation", async () => {
    mockedInvoke.mockResolvedValue(TEMPORARY_ATTACHMENT);

    await expect(
      attachTemporaryAiAttachment(ATTACHMENT.conversationId, "chat"),
    ).resolves.toMatchObject({
      ...TEMPORARY_ATTACHMENT,
      documentId: undefined,
      sha256: undefined,
    });
    expect(mockedInvoke).toHaveBeenCalledWith(
      "attach_temporary_ai_chat_attachment",
      { conversationId: ATTACHMENT.conversationId },
    );
  });

  it("rejects malformed attachment lists", async () => {
    mockedInvoke.mockResolvedValue([{}]);

    await expect(listAiAttachments(ATTACHMENT.conversationId)).rejects.toThrow(
      "AI_ATTACHMENT_INVALID",
    );
  });
});
