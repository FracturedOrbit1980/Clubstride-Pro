import {
  ATTENDANCE_STATUS_LABEL,
  ATTENDANCE_STATUSES,
  attendanceKey,
  type AttendanceMap,
  type AttendanceStatus,
  type AttendanceSummary,
} from '../coach/attendance/attendance';
import { sessionsInWeek, type TrainingWeekday } from '../coach/attendance/trainingDays';
import { METRICS, overallAverage, ratingText, scoredCount, type Scores } from '../coach/player/assessment';

/**
 * What a parent's overview shows, worked out away from the screen so the copy a family reads is
 * harness-tested instead of eyeballed. This module has no write path: a parent's app reads the
 * club and stops, and the row-level policies in Supabase decide which child it answers for.
 */

/** One training session in the week on screen, with the mark the coach left for this child. */
export interface WeekSession {
  date: string;
  status: AttendanceStatus | null;
}

/**
 * The marks are the coach's, never the family's: a session with no row reads as not marked,
 * which is not the same as absent and is not counted in the season run.
 */
export const weekSessions = (
  playerId: string,
  map: AttendanceMap,
  weekStart: string,
  days: readonly TrainingWeekday[],
): WeekSession[] =>
  sessionsInWeek(weekStart, days).map(date => ({
    date,
    status: map[attendanceKey(playerId, date)]?.status ?? null,
  }));

export const markedSessions = (week: readonly WeekSession[]): number =>
  week.filter(session => session.status !== null).length;

/** The next session this week a parent would send a child to, marked or not; null once the week is spent. */
export const nextTraining = (week: readonly WeekSession[], today: string): WeekSession | null =>
  week.find(session => session.date > today) ?? null;

/** Counted rather than a percentage: the denominator sits beside the number, so nothing needs explaining. */
export const seasonRunText = (summary: AttendanceSummary): string => {
  if (summary.sessions === 0) return 'No training session has been marked for this child yet.';
  const noun = summary.sessions === 1 ? 'marked session' : 'marked sessions';
  return `${summary.attended} of ${summary.sessions} ${noun} attended`;
};

/** Only the statuses that happened, so a first season does not read as four rows of zeros. */
export const statusBreakdown = (summary: AttendanceSummary): string => {
  const parts = ATTENDANCE_STATUSES
    .filter(status => summary[status] > 0)
    .map(status => `${ATTENDANCE_STATUS_LABEL[status]} ${summary[status]}`);
  return parts.length === 0 ? 'Nothing marked' : parts.join(' · ');
};

/**
 * Ratings are a mean over the documented 1-5 bands, never a percentage, and a child is never
 * placed in a list against anyone else. A skill with no rating is reported as unrated rather than
 * as the bottom of the scale.
 */
export const ratedText = (scores: Scores): string => {
  const count = scoredCount(scores);
  if (count === 0) return `None of the ${METRICS.length} skills has been rated yet.`;
  return `${count} of ${METRICS.length} skills rated. Average of those ratings: ${ratingText(overallAverage(scores))} on the 1 to 5 scale.`;
};
