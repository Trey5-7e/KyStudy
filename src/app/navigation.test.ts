import { describe, expect, it } from "vitest";

import { resolveStoredView } from "./navigation";

describe("resolveStoredView", () => {
  it("restores a supported menu id", () => {
    expect(resolveStoredView("analytics")).toBe("analytics");
  });

  it.each([null, "", "workspace", "unknown"])(
    "falls back to today for an unsupported stored value: %s",
    (stored) => {
      expect(resolveStoredView(stored)).toBe("today");
    },
  );
});
