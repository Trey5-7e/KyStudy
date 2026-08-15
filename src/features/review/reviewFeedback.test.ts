import { describe, expect, it } from "vitest";

import { reviewRatingForShortcut } from "./reviewFeedback";

describe("reviewRatingForShortcut", () => {
  it("maps left-to-right shortcuts to mastered, uncertain, and failed", () => {
    expect(["1", "2", "3"].map(reviewRatingForShortcut)).toEqual([
      "mastered",
      "uncertain",
      "failed",
    ]);
  });

  it("ignores unrelated keys", () => {
    expect(reviewRatingForShortcut("4")).toBeUndefined();
  });
});
