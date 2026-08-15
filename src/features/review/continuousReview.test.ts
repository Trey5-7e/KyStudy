import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import type { ReviewSchemeToday } from "../../shared/tauri/reviewSchemeClient";
import { buildContinuousReviewSession } from "./continuousReview";

const CONTINUOUS_REVIEW_PANEL_SOURCE = readFileSync(
  new URL("./ContinuousReviewPanel.tsx", import.meta.url),
  "utf8",
);
const APP_CSS_SOURCE = readFileSync(
  new URL("../../app/app.css", import.meta.url),
  "utf8",
);

describe("continuous review window contract", () => {
  it("dismisses the current open request when the dialog closes", () => {
    expect(CONTINUOUS_REVIEW_PANEL_SOURCE).toContain("onClose(): void");
    expect(CONTINUOUS_REVIEW_PANEL_SOURCE).toContain(
      "onRequestClose={onClose}",
    );
    expect(APP_CSS_SOURCE).toContain(
      ".editor-dialog-header {\n  position: relative;",
    );
    expect(APP_CSS_SOURCE).toContain(
      ".editor-dialog-header-actions {\n  position: relative;",
    );
  });
});

function scheme(
  id: string,
  states: Array<"pending" | "completed">,
  options: { enabled?: boolean; rest?: boolean; queued?: boolean } = {},
): ReviewSchemeToday {
  const queued = options.queued ?? true;
  return {
    scheme: {
      id,
      name: id,
      subjectId: `subject-${id}`,
      subjectName: id,
      allSubjectWorkbooks: true,
      dailyQuota: Math.max(1, states.length),
      enabled: options.enabled ?? true,
      documentIds: [],
      typeQuotas: [
        { questionType: "choice", quota: Math.max(1, states.length) },
      ],
      createdAt: 1,
      updatedAt: 1,
    },
    isRestDay: options.rest ?? false,
    dueCount: states.length,
    pendingClassificationCount: 0,
    queue: queued
      ? {
          id: `queue-${id}`,
          schemeId: id,
          queueDate: "2026-07-31",
          quota: Math.max(1, states.length),
          generatedAt: 1,
          completedCount: states.filter((state) => state === "completed")
            .length,
          items: states.map((state, index) => ({
            question: {
              question: {
                id: `${id}-${index}`,
                documentId: "document",
                documentTitle: "习题册",
                subjectInherited: true,
                questionType: "choice",
                classificationSource: "manual",
                title: `第 ${index + 1} 题`,
                difficulty: 3,
                createdAt: 1,
                updatedAt: 1,
              },
              regions: [],
              attempts: [],
              knowledgeLinks: [],
            },
            position: index,
            originDate: "2026-07-31",
            carried: false,
            state,
            insertedAt: 1,
            ...(state === "completed" ? { completedAt: index + 2 } : {}),
          })),
        }
      : undefined,
  };
}

describe("buildContinuousReviewSession", () => {
  it("continues at the first pending item across enabled schemes", () => {
    const session = buildContinuousReviewSession([
      scheme("高数", ["completed"]),
      scheme("线代", ["pending", "pending"]),
    ]);

    expect(session.activeScheme?.scheme.id).toBe("线代");
    expect(session.activeItem?.question.question.id).toBe("线代-0");
    expect(session.activeSchemePosition).toBe(2);
    expect(session.completedCount).toBe(1);
    expect(session.totalCount).toBe(3);
  });

  it("excludes paused and rest-day schemes from the session", () => {
    const session = buildContinuousReviewSession([
      scheme("暂停", ["pending"], { enabled: false }),
      scheme("休息", ["pending"], { rest: true }),
      scheme("正常", ["pending"]),
    ]);

    expect(session.eligibleSchemes.map((item) => item.scheme.id)).toEqual([
      "正常",
    ]);
  });

  it("finds the most recent queue for cross-scheme undo", () => {
    const session = buildContinuousReviewSession([
      scheme("高数", ["completed", "completed"]),
      scheme("线代", ["completed"]),
    ]);

    expect(session.latestCompletedQueueId).toBe("queue-高数");
    expect(session.activeItem).toBeUndefined();
  });
});
