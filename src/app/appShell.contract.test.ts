import { describe, expect, it } from "vitest";

import { PRIMARY_NAVIGATION } from "./AppNavigation";
import { PAGE_META } from "./AppPageContent";

describe("app shell contracts", () => {
  it("keeps the primary navigation ordered and free of utility routes", () => {
    expect(PRIMARY_NAVIGATION.map((item) => item.id)).toEqual([
      "today",
      "planning",
      "workbook",
      "review",
      "library",
      "ai-chat",
      "ai-settings",
    ]);
    expect(new Set(PRIMARY_NAVIGATION.map((item) => item.id)).size).toBe(
      PRIMARY_NAVIGATION.length,
    );
  });

  it("provides metadata for every route, including secondary views", () => {
    expect(Object.keys(PAGE_META).sort()).toEqual([
      "ai-chat",
      "ai-settings",
      "library",
      "planning",
      "review",
      "schedule",
      "settings",
      "today",
      "workbook",
    ]);
    for (const page of Object.values(PAGE_META)) {
      expect(page.label.length).toBeGreaterThan(0);
      expect(page.caption.length).toBeGreaterThan(0);
    }
  });
});
