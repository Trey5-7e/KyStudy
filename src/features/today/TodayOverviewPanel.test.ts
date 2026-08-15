import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("./TodayOverviewPanel.tsx", import.meta.url),
  "utf8",
);
const CYCLE_SOURCE = readFileSync(
  new URL("./TodayCyclePlanSection.tsx", import.meta.url),
  "utf8",
);
const PROGRESS_SOURCE = readFileSync(
  new URL("./TodayProgressSection.tsx", import.meta.url),
  "utf8",
);

function section(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`missing TodayOverviewPanel source marker: ${startMarker}`);
  }
  return source.slice(start, end);
}

describe("today cycle plan item skip contract", () => {
  it("renders explicit allowed actions and state labels", () => {
    const items = section(
      CYCLE_SOURCE,
      "items.map(({ item, overview }) => {",
      "            })}",
    );

    expect(items).toContain("cyclePlanItemActions(item.state)");
    expect(items).toContain("cyclePlanItemStateLabel(item.state)");
    expect(items).toContain("action.targetState");
    expect(items).not.toContain("aria-pressed");
  });

  it("sends exact state intent and preserves replacement focus", () => {
    const update = section(
      SOURCE,
      "const updateCycleItemState = async (",
      "  const undoCycleItem = ",
    );

    expect(update).toContain("targetState,");
    expect(update).toContain("expectedUpdatedAt: item.updatedAt");
    expect(update).toContain("createCyclePlanUndoAction(item, mutation)");
    expect(update).toContain("itemActionRefs.current.get(item.id)");
  });

  it("keeps completion progress separate from skipped count", () => {
    expect(CYCLE_SOURCE).toContain('item.state === "completed"');
    expect(CYCLE_SOURCE).toContain('item.state === "skipped"');
    expect(PROGRESS_SOURCE).toContain(
      "已跳过 {formatOverviewNumber(skippedCycles)} 项",
    );
  });

  it("keeps latest-only identity and exact-state restore", () => {
    expect(SOURCE).toContain("cyclePlanUndoIdentity(current.action)");
    expect(SOURCE).toContain("createCyclePlanUndoRequest(currentUndo.action)");
    expect(SOURCE).toContain("lastItemTriggerRef.current");
  });
});
