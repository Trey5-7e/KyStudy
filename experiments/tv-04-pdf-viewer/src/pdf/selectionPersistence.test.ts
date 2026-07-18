import { describe, expect, it } from "vitest";

import {
  clearSavedSelection,
  loadSavedSelection,
  saveSelection,
  type SavedPdfSelection,
} from "./selectionPersistence";

const SELECTION: SavedPdfSelection = {
  pageNumber: 3,
  region: {
    coordinateVersion: 1,
    xMin: 0.2,
    yMin: 0.3,
    xMax: 0.7,
    yMax: 0.8,
  },
};

describe("versioned selection persistence", () => {
  it("stores and restores only the page and normalized region", () => {
    const storage = memoryStorage();

    saveSelection(SELECTION, storage);

    expect(loadSavedSelection(storage)).toEqual(SELECTION);
    expect(storage.entries()).toEqual([
      ["kystudy:tv04:selection:v1", JSON.stringify(SELECTION)],
    ]);
  });

  it("rejects an unknown coordinate version", () => {
    const storage = memoryStorage();
    storage.setItem(
      "kystudy:tv04:selection:v1",
      JSON.stringify({
        ...SELECTION,
        region: { ...SELECTION.region, coordinateVersion: 2 },
      }),
    );

    expect(loadSavedSelection(storage)).toBeUndefined();
  });

  it("ignores malformed JSON and disabled storage", () => {
    const malformed = memoryStorage();
    malformed.setItem("kystudy:tv04:selection:v1", "not-json");
    const disabled = {
      getItem() {
        throw new Error("STORAGE_DISABLED");
      },
      setItem() {
        throw new Error("STORAGE_DISABLED");
      },
      removeItem() {
        throw new Error("STORAGE_DISABLED");
      },
    };

    expect(loadSavedSelection(malformed)).toBeUndefined();
    expect(loadSavedSelection(disabled)).toBeUndefined();
    expect(() => saveSelection(SELECTION, disabled)).not.toThrow();
    expect(() => clearSavedSelection(disabled)).not.toThrow();
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
    entries() {
      return [...values.entries()];
    },
  };
}
