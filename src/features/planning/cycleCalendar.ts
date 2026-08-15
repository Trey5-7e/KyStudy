export interface CalendarCell {
  date: string;
  day: number;
  currentMonth: boolean;
}

export type CycleScheduleMode = "rhythm" | "even";

export interface CycleSchedulePreviewInput {
  totalUnits: number;
  startDate: string;
  deadline: string;
  studyDaysPerUnit: number;
  scheduleMode: CycleScheduleMode;
  restWeekdays: readonly number[];
}

export interface CycleSchedulePreviewItem {
  unitIndex: number;
  plannedStartDate: string;
  plannedEndDate: string;
}

export interface CycleSchedulePreview {
  items: CycleSchedulePreviewItem[];
  estimatedEndDate: string;
  exceedsDeadline: boolean;
}

const MAX_PLAN_DAYS = 1_095;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  serial: number;
  value: string;
}

export function monthCells(year: number, month: number): CalendarCell[] {
  const first = new Date(year, month, 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayOffset, 12);
  const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
  const cellCount = mondayOffset + daysInMonth <= 35 ? 35 : 42;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + index,
      12,
    );
    return {
      date: localDate(date),
      day: date.getDate(),
      currentMonth: date.getMonth() === month && date.getFullYear() === year,
    };
  });
}

export function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function itemOccursOn(
  date: string,
  item: { plannedStartDate: string; plannedEndDate: string },
): boolean {
  return item.plannedStartDate <= date && item.plannedEndDate >= date;
}

/** Mirrors the Rust cycle-plan generator without creating persisted item state. */
export function previewCycleSchedule(
  input: CycleSchedulePreviewInput,
): CycleSchedulePreview | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const totalUnits = input.totalUnits;
  const studyDaysPerUnit = input.studyDaysPerUnit;
  if (
    !isSafeIntegerInRange(totalUnits, 1, 500) ||
    !isSafeIntegerInRange(studyDaysPerUnit, 1, 30) ||
    (input.scheduleMode !== "rhythm" && input.scheduleMode !== "even")
  ) {
    return undefined;
  }

  const startDate = parseLocalDate(input.startDate);
  const deadline = parseLocalDate(input.deadline);
  if (startDate === undefined || deadline === undefined) {
    return undefined;
  }
  const span = deadline.serial - startDate.serial;
  if (span < 0 || span > MAX_PLAN_DAYS) {
    return undefined;
  }

  const restWeekdays = validateRestWeekdays(input.restWeekdays);
  if (restWeekdays === undefined) {
    return undefined;
  }

  const items =
    input.scheduleMode === "rhythm"
      ? buildRhythmSchedule(
          totalUnits,
          studyDaysPerUnit,
          startDate,
          restWeekdays,
        )
      : buildEvenSchedule(
          totalUnits,
          studyDaysPerUnit,
          startDate,
          deadline,
          restWeekdays,
        );
  if (items === undefined || items.length === 0) {
    return undefined;
  }

  const firstItem = items[0];
  if (firstItem === undefined) {
    return undefined;
  }
  const estimatedEndDate = items.reduce(
    (latest, item) =>
      item.plannedEndDate > latest ? item.plannedEndDate : latest,
    firstItem.plannedEndDate,
  );
  return {
    items,
    estimatedEndDate,
    exceedsDeadline: estimatedEndDate > deadline.value,
  };
}

function buildRhythmSchedule(
  totalUnits: number,
  studyDaysPerUnit: number,
  startDate: LocalDateParts,
  restWeekdays: ReadonlySet<number>,
): CycleSchedulePreviewItem[] | undefined {
  const items: CycleSchedulePreviewItem[] = [];
  for (let index = 0; index < totalUnits; index += 1) {
    const plannedStart = studyDayAt(
      startDate,
      index * studyDaysPerUnit,
      restWeekdays,
    );
    const plannedEnd =
      plannedStart === undefined
        ? undefined
        : studyDayAt(plannedStart, studyDaysPerUnit - 1, restWeekdays);
    if (plannedStart === undefined || plannedEnd === undefined) {
      return undefined;
    }
    items.push({
      unitIndex: index + 1,
      plannedStartDate: plannedStart.value,
      plannedEndDate: plannedEnd.value,
    });
  }
  return items;
}

function buildEvenSchedule(
  totalUnits: number,
  studyDaysPerUnit: number,
  startDate: LocalDateParts,
  deadline: LocalDateParts,
  restWeekdays: ReadonlySet<number>,
): CycleSchedulePreviewItem[] | undefined {
  const studyDays = studyDaysBetween(startDate, deadline, restWeekdays);
  if (studyDays.length === 0) {
    return undefined;
  }

  const denominator = totalUnits - 1;
  const maximum = studyDays.length - 1;
  const items: CycleSchedulePreviewItem[] = [];
  for (let index = 0; index < totalUnits; index += 1) {
    const completionIndex =
      denominator === 0
        ? 0
        : Math.floor(
            (index * maximum + Math.floor(denominator / 2)) / denominator,
          );
    const plannedEnd = studyDays[completionIndex];
    if (plannedEnd === undefined) {
      return undefined;
    }
    const plannedStart = retreatStudyDays(
      plannedEnd,
      studyDaysPerUnit - 1,
      startDate,
      restWeekdays,
    );
    if (plannedStart === undefined) {
      return undefined;
    }
    items.push({
      unitIndex: index + 1,
      plannedStartDate: plannedStart.value,
      plannedEndDate: plannedEnd.value,
    });
  }
  return items;
}

function studyDayAt(
  start: LocalDateParts,
  index: number,
  restWeekdays: ReadonlySet<number>,
): LocalDateParts | undefined {
  let date: LocalDateParts | undefined = start;
  let found = 0;
  while (date !== undefined) {
    if (!restWeekdays.has(weekdayFromMonday(date))) {
      if (found === index) {
        return date;
      }
      found += 1;
    }
    date = moveDays(date, 1);
  }
  return undefined;
}

function retreatStudyDays(
  end: LocalDateParts,
  count: number,
  lowerBound: LocalDateParts,
  restWeekdays: ReadonlySet<number>,
): LocalDateParts | undefined {
  let date = end;
  let remaining = count;
  while (remaining > 0 && date.serial > lowerBound.serial) {
    const previous = moveDays(date, -1);
    if (previous === undefined) {
      return undefined;
    }
    date = previous;
    if (!restWeekdays.has(weekdayFromMonday(date))) {
      remaining -= 1;
    }
  }
  return date.serial < lowerBound.serial ? lowerBound : date;
}

function studyDaysBetween(
  start: LocalDateParts,
  end: LocalDateParts,
  restWeekdays: ReadonlySet<number>,
): LocalDateParts[] {
  const span = end.serial - start.serial;
  const days: LocalDateParts[] = [];
  for (let offset = 0; offset <= span; offset += 1) {
    const date = moveDays(start, offset);
    if (date !== undefined && !restWeekdays.has(weekdayFromMonday(date))) {
      days.push(date);
    }
  }
  return days;
}

function validateRestWeekdays(
  values: unknown,
): ReadonlySet<number> | undefined {
  if (!Array.isArray(values) || values.length >= 7) {
    return undefined;
  }
  const unique = new Set<number>();
  for (const value of values) {
    if (!isSafeIntegerInRange(value, 0, 6) || unique.has(value)) {
      return undefined;
    }
    unique.add(value);
  }
  return unique;
}

function parseLocalDate(value: unknown): LocalDateParts | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  const match = LOCAL_DATE_PATTERN.exec(normalized);
  if (match === null) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    return undefined;
  }
  return {
    year,
    month,
    day,
    serial: daysFromCivil(year, month, day),
    value: normalized,
  };
}

function moveDays(
  date: LocalDateParts,
  days: number,
): LocalDateParts | undefined {
  return localDateFromSerial(date.serial + days);
}

function localDateFromSerial(serial: number): LocalDateParts | undefined {
  const civil = civilFromDays(serial);
  if (civil === undefined) {
    return undefined;
  }
  const [year, month, day] = civil;
  return {
    year,
    month,
    day,
    serial,
    value: `${String(year).padStart(4, "0")}-${String(month).padStart(
      2,
      "0",
    )}-${String(day).padStart(2, "0")}`,
  };
}

function weekdayFromMonday(date: LocalDateParts): number {
  return (((date.serial + 3) % 7) + 7) % 7;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function civilFromDays(days: number): [number, number, number] | undefined {
  const shiftedDays = days + 719_468;
  const era = Math.floor(shiftedDays / 146_097);
  const dayOfEra = shiftedDays - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1_460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  let year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  year += month <= 2 ? 1 : 0;
  return year >= 1 && year <= 9_999 ? [year, month, day] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}
