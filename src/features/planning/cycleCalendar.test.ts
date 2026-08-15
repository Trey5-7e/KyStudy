import { describe, expect, it } from "vitest";

import {
  itemOccursOn,
  monthCells,
  previewCycleSchedule,
  type CycleSchedulePreviewInput,
} from "./cycleCalendar";

describe("cycle calendar", () => {
  it("builds a Monday-first six-week month when the dates need it", () => {
    const cells = monthCells(2026, 2);

    expect(cells).toHaveLength(42);
    expect(cells[0]?.date).toBe("2026-02-23");
    expect(cells[41]?.date).toBe("2026-04-05");
  });

  it("does not render an empty sixth row for a five-week month", () => {
    const cells = monthCells(2026, 6);

    expect(cells).toHaveLength(35);
    expect(cells[0]?.date).toBe("2026-06-29");
    expect(cells[34]?.date).toBe("2026-08-02");
  });

  it("treats every date in a multi-day item as occupied", () => {
    const item = {
      plannedStartDate: "2026-07-29",
      plannedEndDate: "2026-07-31",
    };

    expect(itemOccursOn("2026-07-30", item)).toBe(true);
    expect(itemOccursOn("2026-08-01", item)).toBe(false);
  });

  it("previews rhythm items across rest days and reports overdue schedules", () => {
    const preview = previewCycleSchedule({
      totalUnits: 3,
      startDate: "2026-07-31",
      deadline: "2026-08-02",
      studyDaysPerUnit: 3,
      scheduleMode: "rhythm",
      restWeekdays: [6],
    });

    expect(preview).toEqual({
      items: [
        {
          unitIndex: 1,
          plannedStartDate: "2026-07-31",
          plannedEndDate: "2026-08-03",
        },
        {
          unitIndex: 2,
          plannedStartDate: "2026-08-04",
          plannedEndDate: "2026-08-06",
        },
        {
          unitIndex: 3,
          plannedStartDate: "2026-08-07",
          plannedEndDate: "2026-08-10",
        },
      ],
      estimatedEndDate: "2026-08-10",
      exceedsDeadline: true,
    });
  });

  it("previews even items with Rust-compatible rounded endpoints", () => {
    const preview = previewCycleSchedule({
      totalUnits: 3,
      startDate: "2026-07-29",
      deadline: "2026-08-05",
      studyDaysPerUnit: 3,
      scheduleMode: "even",
      restWeekdays: [6],
    });

    expect(preview?.items).toEqual([
      {
        unitIndex: 1,
        plannedStartDate: "2026-07-29",
        plannedEndDate: "2026-07-29",
      },
      {
        unitIndex: 2,
        plannedStartDate: "2026-07-30",
        plannedEndDate: "2026-08-01",
      },
      {
        unitIndex: 3,
        plannedStartDate: "2026-08-03",
        plannedEndDate: "2026-08-05",
      },
    ]);
    expect(preview?.estimatedEndDate).toBe("2026-08-05");
    expect(preview?.exceedsDeadline).toBe(false);
  });

  it("keeps the even one-unit endpoint deterministic", () => {
    const preview = previewCycleSchedule({
      totalUnits: 1,
      startDate: "2026-07-29",
      deadline: "2026-08-05",
      studyDaysPerUnit: 3,
      scheduleMode: "even",
      restWeekdays: [6],
    });

    expect(preview?.items).toEqual([
      {
        unitIndex: 1,
        plannedStartDate: "2026-07-29",
        plannedEndDate: "2026-07-29",
      },
    ]);
  });

  it("retains duplicate even endpoints when capacity is low", () => {
    const preview = previewCycleSchedule({
      totalUnits: 3,
      startDate: "2026-07-20",
      deadline: "2026-07-20",
      studyDaysPerUnit: 3,
      scheduleMode: "even",
      restWeekdays: [1, 2, 3, 4, 5, 6],
    });

    expect(preview?.items).toEqual([
      {
        unitIndex: 1,
        plannedStartDate: "2026-07-20",
        plannedEndDate: "2026-07-20",
      },
      {
        unitIndex: 2,
        plannedStartDate: "2026-07-20",
        plannedEndDate: "2026-07-20",
      },
      {
        unitIndex: 3,
        plannedStartDate: "2026-07-20",
        plannedEndDate: "2026-07-20",
      },
    ]);
  });

  it("rejects malformed dates, unsupported values, and invalid rest constraints", () => {
    const base: CycleSchedulePreviewInput = {
      totalUnits: 2,
      startDate: "2026-01-01",
      deadline: "2026-01-10",
      studyDaysPerUnit: 1,
      scheduleMode: "rhythm",
      restWeekdays: [],
    };
    const invalidInputs: CycleSchedulePreviewInput[] = [
      { ...base, startDate: "2026-02-29" },
      { ...base, startDate: "2026-1-01" },
      { ...base, startDate: "0000-01-01" },
      { ...base, deadline: "2025-12-31" },
      { ...base, deadline: "2029-01-02" },
      { ...base, totalUnits: 0 },
      { ...base, totalUnits: 501 },
      { ...base, studyDaysPerUnit: 0 },
      { ...base, studyDaysPerUnit: 31 },
      {
        ...base,
        scheduleMode: "other" as CycleSchedulePreviewInput["scheduleMode"],
      },
      { ...base, restWeekdays: [0, 0] },
      { ...base, restWeekdays: [7] },
      { ...base, restWeekdays: [0, 1, 2, 3, 4, 5, 6] },
      {
        ...base,
        scheduleMode: "even",
        startDate: "2026-01-04",
        deadline: "2026-01-04",
        restWeekdays: [6],
      },
    ];

    for (const input of invalidInputs) {
      expect(previewCycleSchedule(input)).toBeUndefined();
    }
  });
});
