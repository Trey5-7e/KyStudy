import { describe, expect, it } from "vitest";

import {
  AUTO_UPDATE_CHECK_INTERVAL_MS,
  shouldRunAutomaticUpdateCheck,
} from "./updatePolicy";

const BASE_INPUT = {
  buildProfile: "release" as const,
  enabled: true,
  lastCheckedAt: 1_000,
  now: 1_000 + AUTO_UPDATE_CHECK_INTERVAL_MS,
};

describe("shouldRunAutomaticUpdateCheck", () => {
  it("runs at the 24-hour boundary for enabled release builds", () => {
    expect(shouldRunAutomaticUpdateCheck(BASE_INPUT)).toBe(true);
  });

  it("waits when the previous check is still fresh", () => {
    expect(
      shouldRunAutomaticUpdateCheck({
        ...BASE_INPUT,
        now: BASE_INPUT.now - 1,
      }),
    ).toBe(false);
  });

  it("does not run for debug builds or a disabled preference", () => {
    expect(
      shouldRunAutomaticUpdateCheck({ ...BASE_INPUT, buildProfile: "debug" }),
    ).toBe(false);
    expect(
      shouldRunAutomaticUpdateCheck({ ...BASE_INPUT, enabled: false }),
    ).toBe(false);
  });

  it("does not run when runtime status is not ready", () => {
    expect(
      shouldRunAutomaticUpdateCheck({ ...BASE_INPUT, buildProfile: null }),
    ).toBe(false);
  });

  it("does not run when the clock moves before the previous check", () => {
    expect(
      shouldRunAutomaticUpdateCheck({
        ...BASE_INPUT,
        lastCheckedAt: BASE_INPUT.now + 1,
      }),
    ).toBe(false);
  });
});
