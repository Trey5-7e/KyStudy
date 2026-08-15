export function formatOverviewDate(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(`${date}T00:00:00Z`));
}

const OVERVIEW_NUMBER_FORMATTER = new Intl.NumberFormat("zh-CN");

export function formatOverviewNumber(value: number): string {
  return OVERVIEW_NUMBER_FORMATTER.format(value);
}
