import { describe, expect, it } from "vitest";

import {
  addLocalDays,
  localWeekDates,
  startOfLocalWeek,
} from "./scheduleDates";

describe("explicit local schedule date calculations", () => {
  it("finds Monday without using the machine current date", () => {
    expect(startOfLocalWeek("2026-07-19")).toBe("2026-07-13");
  });

  it("crosses month boundaries deterministically", () => {
    expect(addLocalDays("2026-07-31", 1)).toBe("2026-08-01");
  });

  it("returns exactly seven consecutive dates", () => {
    expect(localWeekDates("2026-07-15")).toEqual([
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
      "2026-07-19",
    ]);
  });
});
