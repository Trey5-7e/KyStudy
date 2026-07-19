const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MILLISECONDS = 86_400_000;

function localDateTimestamp(value: string): number {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (match === null) {
    throw new Error("LOCAL_DATE_INVALID");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("LOCAL_DATE_INVALID");
  }
  return timestamp;
}

function timestampToLocalDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function addLocalDays(value: string, days: number): string {
  if (!Number.isSafeInteger(days)) {
    throw new Error("LOCAL_DATE_OFFSET_INVALID");
  }
  return timestampToLocalDate(
    localDateTimestamp(value) + days * DAY_MILLISECONDS,
  );
}

export function startOfLocalWeek(value: string): string {
  const timestamp = localDateTimestamp(value);
  const weekday = new Date(timestamp).getUTCDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  return timestampToLocalDate(timestamp - daysFromMonday * DAY_MILLISECONDS);
}

export function localWeekDates(weekStart: string): string[] {
  const normalizedStart = startOfLocalWeek(weekStart);
  return Array.from({ length: 7 }, (_, index) =>
    addLocalDays(normalizedStart, index),
  );
}

export function formatLocalDateLabel(value: string): string {
  const timestamp = localDateTimestamp(value);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(timestamp));
}
