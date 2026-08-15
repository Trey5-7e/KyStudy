import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  nextSettingsTab,
  SETTINGS_PANEL_ID,
  SETTINGS_TABS,
} from "./SettingsPanel";

const SETTINGS_PANEL_SOURCE = readFileSync(
  new URL("./SettingsPanel.tsx", import.meta.url),
  "utf8",
);

describe("settings tab navigation", () => {
  it("keeps the four tabs in the rendered and roving order", () => {
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual([
      "study",
      "ai",
      "data",
      "application",
    ]);
  });

  it("uses one stable panel target for every lazy tab", () => {
    expect(SETTINGS_PANEL_ID).toBe("settings-panel");
  });

  it("keeps the roving tab order circular for arrows", () => {
    expect(nextSettingsTab("study", "ArrowRight")).toBe("ai");
    expect(nextSettingsTab("ai", "ArrowDown")).toBe("data");
    expect(nextSettingsTab("data", "ArrowLeft")).toBe("ai");
    expect(nextSettingsTab("study", "ArrowUp")).toBe("application");
    expect(nextSettingsTab("application", "ArrowRight")).toBe("study");
  });

  it("keeps Home and End as explicit bounds", () => {
    expect(nextSettingsTab("data", "Home")).toBe("study");
    expect(nextSettingsTab("study", "End")).toBe("application");
  });

  it("ignores non-navigation keys", () => {
    expect(nextSettingsTab("study", "Enter")).toBeNull();
  });
});

describe("settings tab DOM contract", () => {
  it("keeps every tab connected to the stable lazy panel", () => {
    expect(SETTINGS_PANEL_SOURCE).toContain(
      '<div className="settings-tabs" role="tablist" aria-label="设置分类">',
    );
    expect(SETTINGS_PANEL_SOURCE).toContain('role="tab"');
    expect(SETTINGS_PANEL_SOURCE).toContain(
      "aria-controls={SETTINGS_PANEL_ID}",
    );
    expect(SETTINGS_PANEL_SOURCE).toContain(
      "aria-describedby={`settings-tab-description-${tab.id}`}",
    );
    expect(SETTINGS_PANEL_SOURCE).toContain('role="tabpanel"');
    expect(SETTINGS_PANEL_SOURCE).toContain(
      "aria-labelledby={`settings-tab-${activeTab}`}",
    );
  });

  it("preserves keyboard focus after roving-tab updates", () => {
    expect(SETTINGS_PANEL_SOURCE).toContain(
      "tabIndex={tab.id === activeTab ? 0 : -1}",
    );
    expect(SETTINGS_PANEL_SOURCE).toContain("event.preventDefault();");
    expect(SETTINGS_PANEL_SOURCE).toContain(
      "requestAnimationFrame(() => settingsTabRefs.current[next]?.focus());",
    );
  });
});
