export const AUTO_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface AutomaticUpdateCheckInput {
  buildProfile: "debug" | "release" | null;
  enabled: boolean;
  lastCheckedAt: number;
  now: number;
}

export function shouldRunAutomaticUpdateCheck({
  buildProfile,
  enabled,
  lastCheckedAt,
  now,
}: AutomaticUpdateCheckInput): boolean {
  if (buildProfile !== "release" || !enabled) {
    return false;
  }

  return now - lastCheckedAt >= AUTO_UPDATE_CHECK_INTERVAL_MS;
}
