import { weekDates, weekdayOf, type Weekday } from './week';

export type TrainingWeekday = Weekday;

export interface WeekdayOption {
  value: TrainingWeekday;
  short: string;
  long: string;
}

export const WEEKDAYS: readonly WeekdayOption[] = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
  { value: 7, short: 'Sun', long: 'Sunday' },
];

const optionFor = (day: TrainingWeekday): WeekdayOption =>
  WEEKDAYS[day - 1] ?? { value: day, short: String(day), long: String(day) };

export const isTrainingWeekday = (value: unknown): value is TrainingWeekday =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7;

/** Anything the server or a stored cache can hold, reduced to a sorted set of weekdays. */
export function normalizeTrainingDays(value: unknown): TrainingWeekday[] {
  if (!Array.isArray(value)) return [];
  const days = new Set<TrainingWeekday>();
  for (const item of value) {
    if (isTrainingWeekday(item)) days.add(item);
  }
  return [...days].sort((a, b) => a - b);
}

export const weekdayShort = (day: TrainingWeekday): string => optionFor(day).short;

export const formatTrainingDays = (days: readonly TrainingWeekday[]): string =>
  days.length === 0
    ? 'No training days set'
    : [...days]
        .sort((a, b) => a - b)
        .map(day => optionFor(day).short)
        .join(', ');

/** The training dates inside the Monday-first week, in calendar order. */
export function sessionsInWeek(weekStart: string, days: readonly TrainingWeekday[]): string[] {
  const wanted = new Set<TrainingWeekday>(days);
  return weekDates(weekStart).filter(date => wanted.has(weekdayOf(date)));
}

export interface TrainingSettings {
  days: TrainingWeekday[];
  /** Phone timestamp of the last edit. Null means nothing has been recorded, locally or on the server. */
  recordedAt: string | null;
}

/** Reads either the server row or the on-phone cache; both carry the same two fields. */
export function parseTrainingSettings(value: unknown): TrainingSettings {
  if (typeof value !== 'object' || value === null) return { days: [], recordedAt: null };
  const raw = value as { training_days?: unknown; recorded_at?: unknown };
  return {
    days: normalizeTrainingDays(raw.training_days),
    recordedAt: typeof raw.recorded_at === 'string' ? raw.recorded_at : null,
  };
}

/**
 * Local-first: an edit queued on this phone has a newer timestamp than the row the club
 * still holds, so a refresh must not overwrite it with stale server days. A tie means the
 * edit has already reached the club, and the server copy wins.
 */
export function pickNewerTrainingSettings(local: TrainingSettings, remote: TrainingSettings): TrainingSettings {
  if (!local.recordedAt) return remote;
  if (!remote.recordedAt) return local;
  return Date.parse(local.recordedAt) > Date.parse(remote.recordedAt) ? local : remote;
}
