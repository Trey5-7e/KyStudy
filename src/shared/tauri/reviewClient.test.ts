import { describe, expect, it } from "vitest";

import { parseReviewDashboard } from "./reviewClient";

const QUESTION_BUNDLE = {
  question: {
    id: "question-id",
    documentId: "document-id",
    documentTitle: "408 习题册",
    subjectId: "subject-id",
    subjectName: "数据结构",
    subjectInherited: true,
    questionType: "solution",
    classificationSource: "manual",
    classificationConfidence: 1,
    title: "线性表错题",
    chapter: "数据结构",
    questionNumber: "1",
    difficulty: 4,
    analysisMarkdown: null,
    deletedAt: null,
    createdAt: 1,
    updatedAt: 2,
  },
  regions: [
    {
      id: "region-id",
      questionId: "question-id",
      documentId: "document-id",
      pageNumber: 1,
      x: 0.1,
      y: 0.2,
      width: 0.4,
      height: 0.2,
      coordinateVersion: 1,
      sortOrder: 0,
      createdAt: 1,
    },
  ],
  attempts: [],
  knowledgeLinks: [],
};

const EVENT = {
  id: "event-id",
  questionId: "question-id",
  attemptId: "attempt-id",
  rating: "mastered",
  previousDueDate: "2026-07-19",
  nextDueDate: "2026-07-26",
  intervalDays: 7,
  policyVersion: 1,
  createdAt: 3,
};

const VALID_DASHBOARD = {
  preferences: { dailyQuota: 5, earlyFillEnabled: false },
  backlog: {
    activeCount: 1,
    dueCount: 1,
    overdueCount: 0,
    queuedRemaining: 0,
    estimatedClearDays: 1,
  },
  queue: {
    id: "queue-id",
    queueDate: "2026-07-19",
    quota: 5,
    generatedAt: 2,
    completedCount: 1,
    items: [
      {
        question: QUESTION_BUNDLE,
        available: true,
        position: 0,
        priorityScore: 180,
        reason: {
          selection: "new",
          overdueDays: 0,
          failureStreak: 0,
          mistakeCount: 1,
          userPriority: 4,
          knowledgeWeakness: 0,
          daysSinceAttempt: 0,
          isEarly: false,
          reasonJson: "private",
        },
        state: "completed",
        reviewEvent: EVENT,
        insertedAt: 2,
        completedAt: 3,
        sql: "SELECT * FROM review_event",
      },
    ],
  },
  activeQuestions: [
    {
      question: QUESTION_BUNDLE,
      profile: {
        questionId: "question-id",
        firstMistakeAt: 1,
        lastMistakeAt: 1,
        mistakeCount: 1,
        consecutiveFailureCount: 0,
        active: true,
        userPriority: 4,
        createdAt: 1,
        updatedAt: 2,
      },
      state: {
        questionId: "question-id",
        policyVersion: 1,
        mastery: "mastered",
        dueDate: "2026-07-26",
        lastReviewedAt: 3,
        successfulStreak: 1,
        manualPinDate: null,
        suspendedAt: null,
        createdAt: 1,
        updatedAt: 3,
      },
      recentEvents: [EVENT],
    },
  ],
  databasePath: "C:/private.sqlite3",
};

describe("parseReviewDashboard", () => {
  it("keeps typed explanations without internal payloads", () => {
    const dashboard = parseReviewDashboard(VALID_DASHBOARD);
    const serialized = JSON.stringify(dashboard);

    expect(dashboard.queue?.items[0]?.reason.selection).toBe("new");
    expect(dashboard.activeQuestions[0]?.state.dueDate).toBe("2026-07-26");
    expect(serialized).not.toContain("reasonJson");
    expect(serialized).not.toContain("databasePath");
    expect(serialized).not.toContain("SELECT");
  });

  it("rejects unknown review ratings", () => {
    expect(() =>
      parseReviewDashboard({
        ...VALID_DASHBOARD,
        queue: {
          ...VALID_DASHBOARD.queue,
          items: [
            {
              ...VALID_DASHBOARD.queue.items[0],
              reviewEvent: { ...EVENT, rating: "easy" },
            },
          ],
        },
      }),
    ).toThrowError("REVIEW_EVENT_INVALID");
  });

  it("rejects a completed-count mismatch", () => {
    expect(() =>
      parseReviewDashboard({
        ...VALID_DASHBOARD,
        queue: { ...VALID_DASHBOARD.queue, completedCount: 0 },
      }),
    ).toThrowError("REVIEW_QUEUE_INVALID");
  });
});
