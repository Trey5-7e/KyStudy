import { describe, expect, it } from "vitest";

import { invokeBrowserPreview } from "./browserPreviewBackend";

describe("browser preview backend", () => {
  it("provides a dense question-bank fixture without local storage", async () => {
    const snapshot = (await invokeBrowserPreview("get_question_bank")) as {
      questions: unknown[];
      segments: unknown[];
    };

    expect(snapshot.questions).toHaveLength(2_343);
    expect(snapshot.segments).toHaveLength(3);
  });

  it("provides planning and knowledge-map fixtures for browser UI review", async () => {
    const dashboard = await invokeBrowserPreview("get_cycle_plan_dashboard");
    const maps = (await invokeBrowserPreview(
      "list_knowledge_maps",
    )) as unknown[];

    expect(dashboard).toMatchObject({ plans: [{ completedCount: 3 }] });
    expect(maps).toHaveLength(1);
  });

  it("provides read-only AI fixtures while keeping writes fail-closed", async () => {
    const overview = (await invokeBrowserPreview("get_ai_overview")) as {
      providers: unknown[];
      activeProviderId: string;
    };
    const conversations = (await invokeBrowserPreview(
      "list_ai_chat_conversations",
    )) as Array<{ kind: string; messages: unknown[] }>;
    const attachments = (await invokeBrowserPreview(
      "list_ai_chat_attachments",
    )) as unknown[];

    expect(overview.providers).toHaveLength(1);
    expect(overview.activeProviderId).toBe("preview-provider-local");
    expect(conversations[0]).toMatchObject({
      kind: "chat",
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "assistant" }),
      ]),
    });
    expect(attachments).toHaveLength(1);
    await expect(invokeBrowserPreview("execute_ai_chat")).rejects.toThrow(
      "BROWSER_PREVIEW_UNSUPPORTED:execute_ai_chat",
    );
  });

  it("provides question AI history fixtures for renderer review", async () => {
    const history = (await invokeBrowserPreview(
      "list_question_ai_analysis_history",
    )) as Array<{ result: { responseText: string } }>;

    expect(history).toHaveLength(3);
    expect(history[0]?.result.responseText).toContain("\\vec");
    expect(history[1]?.result.responseText).toContain("\\begin{aligned}");
    expect(history[2]?.result.responseText).toContain("\\boxed");
  });

  it("fails closed for commands that are not safe preview operations", async () => {
    await expect(
      invokeBrowserPreview("delete_workspace" as string),
    ).rejects.toThrow("BROWSER_PREVIEW_UNSUPPORTED:delete_workspace");
  });
});
