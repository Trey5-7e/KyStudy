import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CyclePlanEditor } from "./CyclePlanEditor";
import type { CyclePlanDraft } from "./cyclePlanViewModel";

const VALID_DRAFT: CyclePlanDraft = {
  name: "数学模拟卷",
  totalUnits: "3",
  unitLabel: "套",
  startDate: "2026-08-13",
  deadline: "2026-08-20",
  studyDaysPerUnit: "2",
  scheduleMode: "rhythm",
  calendarVisible: true,
};

function markupFor(draft: CyclePlanDraft, restWeekdays: number[] = []): string {
  return renderToStaticMarkup(
    <CyclePlanEditor
      draft={draft}
      restWeekdays={restWeekdays}
      busy={false}
      onChange={vi.fn()}
      onSave={vi.fn(async () => undefined)}
    />,
  );
}

describe("CyclePlanEditor DOM contract", () => {
  it("keeps preview and save disabled while the draft is incomplete", () => {
    const markup = markupFor({ ...VALID_DRAFT, name: "" });

    expect(markup).toContain("填写完整信息后查看日期预览。");
    expect(markup).not.toContain("预计 2026年8月");
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("确认排程并保存");
  });

  it("renders a valid schedule preview and enables confirmation", () => {
    const markup = markupFor(VALID_DRAFT);

    expect(markup).toContain("排程预览");
    expect(markup).toContain("预计");
    expect(markup).toContain("第 1 套");
    expect(markup).toContain("第 3 套");
    expect(markup).not.toContain("填写完整信息后查看日期预览。");
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>确认排程并保存/);
  });

  it("applies rest weekdays before rendering the date ranges", () => {
    const withoutRest = markupFor(VALID_DRAFT);
    const withSaturdayRest = markupFor(VALID_DRAFT, [5]);

    expect(withSaturdayRest).not.toBe(withoutRest);
    expect(withSaturdayRest).toContain("第 3 套");
    expect(withSaturdayRest).toContain("预计");
  });

  it("keeps even scheduling as a selectable preview mode", () => {
    const markup = markupFor({ ...VALID_DRAFT, scheduleMode: "even" });

    expect(markup).toContain('value="even" selected');
    expect(markup).toContain("确认排程并保存");
  });
});
