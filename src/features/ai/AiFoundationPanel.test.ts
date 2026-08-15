import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const AI_PANEL_SOURCE = readFileSync(
  new URL("./AiFoundationPanel.tsx", import.meta.url),
  "utf8",
);

describe("production AI settings surface", () => {
  it("keeps the offline provider out of the user configuration workflow", () => {
    expect(AI_PANEL_SOURCE).toContain(
      'return provider.providerType !== "offline_test";',
    );
    expect(AI_PANEL_SOURCE).toContain("visibleProviders.map");
    expect(AI_PANEL_SOURCE).not.toContain(
      '<option value="offline_test">离线测试</option>',
    );
  });
});
