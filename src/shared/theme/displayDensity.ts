export type DisplayDensity = "compact" | "comfortable" | "auto";

export const DISPLAY_DENSITY_STORAGE_KEY = "kystudy.display-density";

export function resolveEffectiveDensity(
  density: DisplayDensity,
): "compact" | "comfortable" {
  if (density === "compact" || density === "comfortable") {
    return density;
  }
  const mm =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia
      : typeof matchMedia === "function"
        ? matchMedia
        : undefined;

  if (mm) {
    if (mm("(pointer: coarse)").matches) {
      return "comfortable";
    }
  }
  return "compact";
}

export function getStoredDensity(): DisplayDensity {
  if (typeof localStorage === "undefined") {
    return "auto";
  }
  try {
    const raw = localStorage.getItem(DISPLAY_DENSITY_STORAGE_KEY);
    if (raw === "compact" || raw === "comfortable" || raw === "auto") {
      return raw;
    }
  } catch {
    // Ignore storage quota or security errors
  }
  return "auto";
}

export function setStoredDensity(density: DisplayDensity): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(DISPLAY_DENSITY_STORAGE_KEY, density);
    }
  } catch {
    // Ignore storage quota or security errors
  }
  applyDensity(density);
}

export function applyDensity(density: DisplayDensity): void {
  if (typeof document === "undefined") return;
  const effective = resolveEffectiveDensity(density);
  document.documentElement.setAttribute("data-density", effective);
  document.documentElement.setAttribute("data-density-preference", density);
}
