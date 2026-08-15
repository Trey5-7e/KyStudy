import type { ReviewSchemeRating } from "../../shared/tauri/reviewSchemeClient";

const RATING_BY_SHORTCUT: Readonly<Record<string, ReviewSchemeRating>> = {
  "1": "mastered",
  "2": "uncertain",
  "3": "failed",
};

export function reviewRatingForShortcut(
  key: string,
): ReviewSchemeRating | undefined {
  return RATING_BY_SHORTCUT[key];
}
