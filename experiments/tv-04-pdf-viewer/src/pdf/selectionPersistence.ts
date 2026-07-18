import type { NormalizedPdfRegion } from "./coordinates";

const STORAGE_KEY = "kystudy:tv04:selection:v1";

export interface SavedPdfSelection {
  readonly pageNumber: number;
  readonly region: NormalizedPdfRegion;
}

interface SelectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadSavedSelection(
  storage: SelectionStorage = window.localStorage,
): SavedPdfSelection | undefined {
  try {
    const value = storage.getItem(STORAGE_KEY);
    if (value === null) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(value);
    return isSavedSelection(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function saveSelection(
  selection: SavedPdfSelection,
  storage: SelectionStorage = window.localStorage,
) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Persistence is optional in the Spike; the in-memory selection remains usable.
  }
}

export function clearSavedSelection(
  storage: SelectionStorage = window.localStorage,
) {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // A disabled storage backend must not break PDF viewing.
  }
}

function isSavedSelection(value: unknown): value is SavedPdfSelection {
  if (
    !isRecord(value) ||
    typeof value.pageNumber !== "number" ||
    !Number.isSafeInteger(value.pageNumber) ||
    value.pageNumber < 1
  ) {
    return false;
  }
  const region = value.region;
  return (
    isRecord(region) &&
    region.coordinateVersion === 1 &&
    unit(region.xMin) &&
    unit(region.yMin) &&
    unit(region.xMax) &&
    unit(region.yMax) &&
    region.xMax > region.xMin &&
    region.yMax > region.yMin
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}
