import { describe, expect, it } from "vitest";

import {
  primaryViewFor,
  resolveHashView,
  resolveStoredView,
  shouldInterceptNavigationClick,
  storedViewFor,
} from "./navigation";

describe("resolveStoredView", () => {
  it("restores a supported menu id", () => {
    expect(resolveStoredView("workbook")).toBe("workbook");
    expect(resolveStoredView("settings")).toBe("settings");
  });

  it.each([
    ["schedule", "planning"],
    ["mindmap", "library"],
    ["analytics", "today"],
    ["ai", "ai-settings"],
    ["data", "settings"],
  ])("migrates the retired stored view %s to %s", (stored, expected) => {
    expect(resolveStoredView(stored)).toBe(expected);
  });

  it.each([null, "", "workspace", "unknown"])(
    "falls back to today for an unsupported stored value: %s",
    (stored) => {
      expect(resolveStoredView(stored)).toBe("today");
    },
  );
});

describe("resolveHashView", () => {
  it("accepts current views with or without a leading hash", () => {
    expect(resolveHashView("#planning")).toBe("planning");
    expect(resolveHashView("review")).toBe("review");
    expect(resolveHashView("#schedule")).toBe("schedule");
  });

  it("migrates retired hashes and rejects unknown hashes", () => {
    expect(resolveHashView("#mindmap")).toBe("library");
    expect(resolveHashView("#ai")).toBe("ai-settings");
    expect(resolveHashView("#unknown")).toBeUndefined();
  });
});

describe("navigation sections", () => {
  it("keeps the legacy schedule inside the plan navigation section", () => {
    expect(primaryViewFor("schedule")).toBe("planning");
    expect(storedViewFor("schedule")).toBe("planning");
  });

  it("does not highlight a primary item while settings is open", () => {
    expect(primaryViewFor("settings")).toBeUndefined();
  });

  it("keeps the AI workspaces as primary navigation views", () => {
    expect(primaryViewFor("ai-chat")).toBe("ai-chat");
    expect(primaryViewFor("ai-settings")).toBe("ai-settings");
  });
});

describe("shouldInterceptNavigationClick", () => {
  const click = (
    overrides: Partial<
      Parameters<typeof shouldInterceptNavigationClick>[0]
    > = {},
  ) => ({
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  });

  it("handles an ordinary primary-button click", () => {
    expect(shouldInterceptNavigationClick(click())).toBe(true);
  });

  it.each([
    ["middle-click", { button: 1 }],
    ["Cmd-click", { metaKey: true }],
    ["Ctrl-click", { ctrlKey: true }],
    ["Shift-click", { shiftKey: true }],
    ["Alt-click", { altKey: true }],
  ])("leaves %s to the browser", (_label, overrides) => {
    expect(shouldInterceptNavigationClick(click(overrides))).toBe(false);
  });
});
