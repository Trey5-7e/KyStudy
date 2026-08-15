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

  it("fails closed for commands that are not safe preview operations", async () => {
    await expect(
      invokeBrowserPreview("delete_workspace" as string),
    ).rejects.toThrow("BROWSER_PREVIEW_UNSUPPORTED:delete_workspace");
  });
});
