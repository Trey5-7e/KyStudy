import { describe, expect, it } from "vitest";

import { scheduleOverviewTabIndexAfterKey } from "./ScheduleOverviewPanel";

describe("schedule overview tab keyboard navigation", () => {
  it("wraps arrow navigation in both directions", () => {
    expect(scheduleOverviewTabIndexAfterKey(0, "ArrowLeft", 4)).toBe(3);
    expect(scheduleOverviewTabIndexAfterKey(3, "ArrowRight", 4)).toBe(0);
    expect(scheduleOverviewTabIndexAfterKey(1, "ArrowDown", 4)).toBe(2);
    expect(scheduleOverviewTabIndexAfterKey(2, "ArrowUp", 4)).toBe(1);
  });

  it("supports Home and End", () => {
    expect(scheduleOverviewTabIndexAfterKey(2, "Home", 4)).toBe(0);
    expect(scheduleOverviewTabIndexAfterKey(1, "End", 4)).toBe(3);
  });

  it("ignores unrelated keys and empty tab lists", () => {
    expect(scheduleOverviewTabIndexAfterKey(1, "Enter", 4)).toBeUndefined();
    expect(
      scheduleOverviewTabIndexAfterKey(0, "ArrowRight", 0),
    ).toBeUndefined();
  });
});
