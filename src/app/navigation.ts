export type AppView =
  | "today"
  | "schedule"
  | "planning"
  | "library"
  | "mindmap"
  | "workbook"
  | "review"
  | "analytics"
  | "ai"
  | "data";

const VIEW_IDS = new Set<AppView>([
  "today",
  "schedule",
  "planning",
  "library",
  "mindmap",
  "workbook",
  "review",
  "analytics",
  "ai",
  "data",
]);

export function resolveStoredView(stored: string | null): AppView {
  return stored !== null && VIEW_IDS.has(stored as AppView)
    ? (stored as AppView)
    : "today";
}
