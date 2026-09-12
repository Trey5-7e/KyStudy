import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyDensity,
  DISPLAY_DENSITY_STORAGE_KEY,
  getStoredDensity,
  resolveEffectiveDensity,
  setStoredDensity,
} from "./displayDensity";

class MockStorage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

describe("displayDensity", () => {
  let mockStorage: MockStorage;
  const attributes = new Map<string, string>();

  beforeEach(() => {
    mockStorage = new MockStorage();
    attributes.clear();

    vi.stubGlobal("localStorage", mockStorage);
    vi.stubGlobal("document", {
      documentElement: {
        setAttribute: (key: string, val: string) => attributes.set(key, val),
        getAttribute: (key: string) => attributes.get(key) ?? null,
        removeAttribute: (key: string) => attributes.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("resolveEffectiveDensity", () => {
    it("preserves explicit compact and comfortable densities", () => {
      expect(resolveEffectiveDensity("compact")).toBe("compact");
      expect(resolveEffectiveDensity("comfortable")).toBe("comfortable");
    });

    it("defaults auto to compact in desktop-like environment", () => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn().mockImplementation((query: string) => ({
          matches: false,
          media: query,
        })),
      );
      expect(resolveEffectiveDensity("auto")).toBe("compact");
    });

    it("resolves auto to comfortable when pointer is coarse (touch screen)", () => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn().mockImplementation((query: string) => ({
          matches: query.includes("pointer: coarse"),
          media: query,
        })),
      );
      expect(resolveEffectiveDensity("auto")).toBe("comfortable");
    });
  });

  describe("getStoredDensity", () => {
    it("returns auto when nothing is stored", () => {
      expect(getStoredDensity()).toBe("auto");
    });

    it("returns valid stored densities", () => {
      localStorage.setItem(DISPLAY_DENSITY_STORAGE_KEY, "compact");
      expect(getStoredDensity()).toBe("compact");

      localStorage.setItem(DISPLAY_DENSITY_STORAGE_KEY, "comfortable");
      expect(getStoredDensity()).toBe("comfortable");
    });

    it("falls back to auto for invalid stored value", () => {
      localStorage.setItem(DISPLAY_DENSITY_STORAGE_KEY, "invalid-value");
      expect(getStoredDensity()).toBe("auto");
    });
  });

  describe("setStoredDensity and applyDensity", () => {
    it("persists density to localStorage and applies data attributes to document", () => {
      setStoredDensity("comfortable");
      expect(localStorage.getItem(DISPLAY_DENSITY_STORAGE_KEY)).toBe(
        "comfortable",
      );
      expect(document.documentElement.getAttribute("data-density")).toBe(
        "comfortable",
      );
      expect(
        document.documentElement.getAttribute("data-density-preference"),
      ).toBe("comfortable");

      setStoredDensity("compact");
      expect(localStorage.getItem(DISPLAY_DENSITY_STORAGE_KEY)).toBe("compact");
      expect(document.documentElement.getAttribute("data-density")).toBe(
        "compact",
      );
      expect(
        document.documentElement.getAttribute("data-density-preference"),
      ).toBe("compact");
    });

    it("applies auto with calculated effective density", () => {
      applyDensity("auto");
      expect(
        document.documentElement.getAttribute("data-density-preference"),
      ).toBe("auto");
      expect(document.documentElement.getAttribute("data-density")).toBe(
        "compact",
      );
    });
  });
});
