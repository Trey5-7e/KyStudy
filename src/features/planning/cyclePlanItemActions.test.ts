import { describe, expect, it } from "vitest";

import {
  cyclePlanItemActions,
  cyclePlanItemStateLabel,
  cyclePlanItemTransitionNotice,
} from "./cyclePlanItemActions";

describe("cycle plan item actions", () => {
  it("offers only pending to completed or skipped transitions", () => {
    expect(cyclePlanItemActions("pending")).toEqual([
      { label: "完成", targetState: "completed" },
      { label: "跳过本次", targetState: "skipped" },
    ]);
  });

  it("does not expose completed and skipped direct transitions", () => {
    expect(cyclePlanItemActions("completed")).toEqual([
      { label: "恢复未完成", targetState: "pending" },
    ]);
    expect(cyclePlanItemActions("skipped")).toEqual([
      { label: "恢复待办", targetState: "pending" },
    ]);
  });

  it("keeps labels and notices explicit", () => {
    expect(cyclePlanItemStateLabel("pending")).toBe("待完成");
    expect(cyclePlanItemStateLabel("completed")).toBe("已完成");
    expect(cyclePlanItemStateLabel("skipped")).toBe("已跳过");
    expect(cyclePlanItemTransitionNotice("pending", "skipped")).toBe(
      "已跳过本次周期事项。",
    );
    expect(cyclePlanItemTransitionNotice("skipped", "pending")).toBe(
      "已恢复为待办。",
    );
  });
});
