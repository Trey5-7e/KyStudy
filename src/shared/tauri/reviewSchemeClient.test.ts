import { describe, expect, it } from "vitest";

import {
  parseReviewSchemeDashboard,
  reviewSchemesNeedingQueue,
} from "./reviewSchemeClient";

const QUESTION = {
  question: {
    id: "question-id",
    documentId: "document-id",
    documentTitle: "高数习题册",
    subjectId: "subject-id",
    subjectName: "高等数学",
    subjectInherited: true,
    questionType: "choice",
    classificationSource: "manual",
    classificationConfidence: 1,
    title: "第 1 题",
    chapter: null,
    questionNumber: "1",
    difficulty: 3,
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
      y: 0.1,
      width: 0.5,
      height: 0.3,
      coordinateVersion: 1,
      sortOrder: 0,
      createdAt: 1,
    },
  ],
  attempts: [],
  knowledgeLinks: [],
};

const DASHBOARD = {
  restWeekdays: [6],
  schemes: [
    {
      scheme: {
        id: "scheme-id",
        name: "高数每日错题",
        subjectId: "subject-id",
        subjectName: "高等数学",
        allSubjectWorkbooks: false,
        dailyQuota: 2,
        enabled: true,
        documentIds: ["document-id"],
        typeQuotas: [
          { questionType: "choice", quota: 1 },
          { questionType: "blank", quota: 0 },
          { questionType: "solution", quota: 1 },
          { questionType: "other", quota: 0 },
        ],
        createdAt: 1,
        updatedAt: 2,
      },
      isRestDay: false,
      dueCount: 1,
      pendingClassificationCount: 0,
      queue: {
        id: "queue-id",
        schemeId: "scheme-id",
        queueDate: "2026-07-28",
        quota: 2,
        generatedAt: 3,
        completedCount: 0,
        items: [
          {
            question: QUESTION,
            position: 0,
            originDate: "2026-07-27",
            carried: true,
            state: "pending",
            reviewEvent: null,
            insertedAt: 3,
            completedAt: null,
          },
        ],
      },
    },
  ],
};

describe("parseReviewSchemeDashboard", () => {
  it("keeps stable carryover and fixed type quotas", () => {
    const dashboard = parseReviewSchemeDashboard(DASHBOARD);

    expect(dashboard.schemes[0]?.queue?.items[0]?.carried).toBe(true);
    expect(dashboard.schemes[0]?.scheme.typeQuotas).toHaveLength(4);
  });

  it("rejects quota totals that differ from the daily quota", () => {
    expect(() =>
      parseReviewSchemeDashboard({
        ...DASHBOARD,
        schemes: [
          {
            ...DASHBOARD.schemes[0],
            scheme: {
              ...DASHBOARD.schemes[0]?.scheme,
              dailyQuota: 5,
            },
          },
        ],
      }),
    ).toThrowError("REVIEW_SCHEME_INVALID");
  });

  it("exposes the saved rating needed by the completion recheck", () => {
    const dashboard = parseReviewSchemeDashboard({
      ...DASHBOARD,
      schemes: [
        {
          ...DASHBOARD.schemes[0],
          queue: {
            ...DASHBOARD.schemes[0]?.queue,
            completedCount: 1,
            items: [
              {
                ...DASHBOARD.schemes[0]?.queue.items[0],
                state: "completed",
                completedAt: 4,
                reviewEvent: { rating: "failed" },
              },
            ],
          },
        },
      ],
    });

    expect(dashboard.schemes[0]?.queue?.items[0]?.rating).toBe("failed");
  });
});

describe("reviewSchemesNeedingQueue", () => {
  it("only prepares enabled non-rest schemes without an existing queue", () => {
    const dashboard = parseReviewSchemeDashboard({
      ...DASHBOARD,
      schemes: [
        { ...DASHBOARD.schemes[0], queue: null },
        {
          ...DASHBOARD.schemes[0],
          scheme: {
            ...DASHBOARD.schemes[0]?.scheme,
            id: "paused-scheme",
            enabled: false,
          },
          queue: null,
        },
        {
          ...DASHBOARD.schemes[0],
          scheme: {
            ...DASHBOARD.schemes[0]?.scheme,
            id: "rest-scheme",
          },
          isRestDay: true,
          queue: null,
        },
        {
          ...DASHBOARD.schemes[0],
          scheme: {
            ...DASHBOARD.schemes[0]?.scheme,
            id: "ready-scheme",
          },
        },
      ],
    });

    expect(reviewSchemesNeedingQueue(dashboard)).toEqual(["scheme-id"]);
  });
});
