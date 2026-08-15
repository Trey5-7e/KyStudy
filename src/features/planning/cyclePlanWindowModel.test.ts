import { describe, expect, it } from "vitest";

import type { CyclePlanOverview } from "../../shared/tauri/cyclePlanClient";
import {
  cyclePlanProgressLabel,
  cyclePlanVisibilityLabel,
  cyclePlanVisibilityStatus,
  type CyclePlanWindowMode,
} from "./cyclePlanWindowModel";

const overview = {
  plan: { totalUnits: 20, unitLabel: "套" },
  completedCount: 7,
} as CyclePlanOverview;

describe("cycle plan window model", () => {
  it("keeps the management modes within one window", () => {
    const modes: CyclePlanWindowMode[] = ["summary", "edit", "archive"];
    expect(modes).toEqual(["summary", "edit", "archive"]);
  });

  it("describes progress and calendar visibility", () => {
    expect(cyclePlanProgressLabel(overview)).toBe("已完成 7 / 20 套");
    expect(cyclePlanVisibilityLabel(true)).toBe("从月历隐藏");
    expect(cyclePlanVisibilityLabel(false)).toBe("显示在月历");
    expect(cyclePlanVisibilityStatus(true)).toBe("已显示在月历");
    expect(cyclePlanVisibilityStatus(false)).toBe("已从月历隐藏");
  });
});
