export type AppView =
  | "today"
  | "schedule"
  | "planning"
  | "library"
  | "workbook"
  | "review"
  | "settings";

export type PrimaryAppView = Exclude<AppView, "schedule" | "settings">;

/**
 * Returns whether an anchor click is the ordinary left-click that the app
 * router may handle. Modified clicks intentionally stay native so users keep
 * Cmd/Ctrl-click, Shift-click, Alt-click, and middle-click behavior.
 */
export function shouldInterceptNavigationClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

const HASH_VIEW_IDS = new Set<AppView>([
  "today",
  "schedule",
  "planning",
  "library",
  "workbook",
  "review",
  "settings",
]);

const STORED_VIEW_MIGRATIONS: Readonly<Record<string, AppView>> = {
  schedule: "planning",
  mindmap: "library",
  analytics: "today",
  ai: "settings",
  data: "settings",
};

export function resolveStoredView(stored: string | null): AppView {
  if (stored === null) {
    return "today";
  }
  if (stored in STORED_VIEW_MIGRATIONS) {
    return STORED_VIEW_MIGRATIONS[stored]!;
  }
  return HASH_VIEW_IDS.has(stored as AppView) ? (stored as AppView) : "today";
}

export function resolveHashView(hash: string): AppView | undefined {
  const value = hash.replace(/^#/, "");
  if (HASH_VIEW_IDS.has(value as AppView)) {
    return value as AppView;
  }
  return value in STORED_VIEW_MIGRATIONS
    ? STORED_VIEW_MIGRATIONS[value]
    : undefined;
}

export function storedViewFor(view: AppView): AppView {
  return view === "schedule" ? "planning" : view;
}

export function primaryViewFor(view: AppView): PrimaryAppView | undefined {
  if (view === "schedule") {
    return "planning";
  }
  return view === "settings" ? undefined : view;
}
