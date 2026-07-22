import { describe, expect, it } from "vitest";

import { parseAnalyticsOverview } from "./analyticsClient";

const SUMMARY = {
  taskCount: 3,
  completedTaskCount: 2,
  completionRatePercent: 67,
  plannedMinutes: 180,
  actualMinutes: 150,
  attemptCount: 4,
  correctAttemptCount: 3,
  accuracyPercent: 75,
  reviewItemCount: 5,
  completedReviewCount: 4,
  reviewCompletionPercent: 80,
  aiTokens: 120,
};

const OVERVIEW = {
  rangeStart: "2026-07-16",
  rangeEnd: "2026-07-22",
  previousRangeStart: "2026-07-09",
  previousRangeEnd: "2026-07-15",
  current: SUMMARY,
  previous: { ...SUMMARY, completionRatePercent: null },
  backlog: {
    overdueTasks: 1,
    activeMistakes: 2,
    dueReviews: 2,
    queuedReviews: 1,
  },
  daily: [
    {
      date: "2026-07-22",
      taskCount: 1,
      completedTaskCount: 1,
      plannedMinutes: 60,
      actualMinutes: 45,
      attemptCount: 1,
      correctAttemptCount: 1,
      reviewItemCount: 1,
      completedReviewCount: 1,
      aiTokens: 10,
    },
  ],
  subjects: [
    {
      subjectId: "subject-id",
      subjectName: "408",
      colorKey: "blue",
      taskCount: 3,
      completedTaskCount: 2,
      completionRatePercent: 67,
      actualMinutes: 150,
    },
  ],
  knowledge: [],
  repeatedMistakes: [],
  databasePath: "C:/private.sqlite3",
};

describe("parseAnalyticsOverview", () => {
  it("keeps typed aggregates without storage internals", () => {
    const parsed = parseAnalyticsOverview(OVERVIEW);
    const serialized = JSON.stringify(parsed);

    expect(parsed.current.completionRatePercent).toBe(67);
    expect(parsed.previous.completionRatePercent).toBeUndefined();
    expect(serialized).not.toContain("databasePath");
  });

  it("rejects a percentage above one hundred", () => {
    expect(() =>
      parseAnalyticsOverview({
        ...OVERVIEW,
        current: { ...SUMMARY, accuracyPercent: 101 },
      }),
    ).toThrowError("ANALYTICS_SUMMARY_INVALID");
  });
});
