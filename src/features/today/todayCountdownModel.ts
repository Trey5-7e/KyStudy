import type { StudyPlan } from "../../shared/tauri/planningClient";

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MILLISECONDS = 86_400_000;

export interface ExamCountdown {
  planId: string;
  examName: string;
  examDate: string;
  daysRemaining: number;
  isToday: boolean;
}

/** Returns the nearest future exam on an active plan, using UTC date arithmetic. */
export function selectUpcomingExam(
  plans: readonly StudyPlan[],
  today: string,
): ExamCountdown | undefined {
  const todayTimestamp = parseLocalDate(today);
  if (todayTimestamp === undefined) {
    return undefined;
  }

  let nearest:
    { plan: StudyPlan; examDate: string; timestamp: number } | undefined;
  for (const plan of plans) {
    if (plan.status !== "active" || plan.examDate === undefined) {
      continue;
    }
    const timestamp = parseLocalDate(plan.examDate);
    if (timestamp === undefined || timestamp < todayTimestamp) {
      continue;
    }
    if (nearest === undefined || timestamp < nearest.timestamp) {
      nearest = { plan, examDate: plan.examDate, timestamp };
    }
  }

  if (nearest === undefined) {
    return undefined;
  }

  const daysRemaining = Math.round(
    (nearest.timestamp - todayTimestamp) / DAY_MILLISECONDS,
  );
  return {
    planId: nearest.plan.id,
    examName: nearest.plan.targetExam?.trim() || nearest.plan.title,
    examDate: nearest.examDate,
    daysRemaining,
    isToday: daysRemaining === 0,
  };
}

export function daysUntilExam(
  today: string,
  examDate: string,
): number | undefined {
  const todayTimestamp = parseLocalDate(today);
  const examTimestamp = parseLocalDate(examDate);
  if (todayTimestamp === undefined || examTimestamp === undefined) {
    return undefined;
  }
  return Math.round((examTimestamp - todayTimestamp) / DAY_MILLISECONDS);
}

function parseLocalDate(value: string): number | undefined {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (match === null) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  parsed.setUTCHours(0, 0, 0, 0);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return undefined;
  }
  return parsed.getTime();
}
