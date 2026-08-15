import type {
  ReviewSchemeQueueItem,
  ReviewSchemeToday,
} from "../../shared/tauri/reviewSchemeClient";

export interface ContinuousReviewSession {
  eligibleSchemes: ReviewSchemeToday[];
  queuedSchemes: ReviewSchemeToday[];
  activeScheme?: ReviewSchemeToday;
  activeItem?: ReviewSchemeQueueItem;
  activeSchemePosition: number;
  completedCount: number;
  totalCount: number;
  latestCompletedQueueId?: string;
}

export function buildContinuousReviewSession(
  schemes: ReviewSchemeToday[],
): ContinuousReviewSession {
  const eligibleSchemes = schemes.filter(
    (item) => item.scheme.enabled && !item.isRestDay,
  );
  const queuedSchemes = eligibleSchemes.filter(
    (item) => item.queue !== undefined,
  );
  let activeScheme: ReviewSchemeToday | undefined;
  let activeItem: ReviewSchemeQueueItem | undefined;
  let completedCount = 0;
  let totalCount = 0;
  let latestCompletedAt = -1;
  let latestCompletedQueueId: string | undefined;

  for (const item of queuedSchemes) {
    const queue = item.queue;
    if (queue === undefined) continue;
    completedCount += queue.completedCount;
    totalCount += queue.items.length;
    if (activeItem === undefined) {
      const pending = queue.items.find((entry) => entry.state === "pending");
      if (pending !== undefined) {
        activeScheme = item;
        activeItem = pending;
      }
    }
    for (const entry of queue.items) {
      if (
        entry.state === "completed" &&
        entry.completedAt !== undefined &&
        entry.completedAt > latestCompletedAt
      ) {
        latestCompletedAt = entry.completedAt;
        latestCompletedQueueId = queue.id;
      }
    }
  }

  return {
    eligibleSchemes,
    queuedSchemes,
    activeScheme,
    activeItem,
    activeSchemePosition:
      activeScheme === undefined
        ? 0
        : queuedSchemes.findIndex(
            (item) => item.scheme.id === activeScheme?.scheme.id,
          ) + 1,
    completedCount,
    totalCount,
    latestCompletedQueueId,
  };
}
