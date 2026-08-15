import { describe, expect, it } from "vitest";

import { formatOverviewDate, formatOverviewNumber } from "./todayOverviewModel";

describe("formatOverviewDate", () => {
  it("formats a local-date value without shifting the day", () => {
    expect(formatOverviewDate("2026-07-28")).toContain("2026年7月28日");
  });
});

describe("formatOverviewNumber", () => {
  it("formats counts using the Chinese locale", () => {
    expect(formatOverviewNumber(1234)).toBe("1,234");
  });
});
