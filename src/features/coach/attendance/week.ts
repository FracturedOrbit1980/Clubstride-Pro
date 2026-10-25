// Monday-first weeks, ported from the Football roster: training is planned per weekday and
// read per week, so a session is addressed by its ISO date and its weekday number.

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const pad = (value: number): string => String(value).padStart(2, '0');

export const isoFromDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * Parsed field by field on purpose: `new Date('2026-10-26')` is UTC midnight, which renders
 * as the previous day west of Greenwich and would move a session to the wrong date.
 */
export function parseIso(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) throw new Error(`Not an ISO date: ${iso}`);
  return new Date(year, month - 1, day);
}

export const sessionToday = (): string => isoFromDate(new Date());

export function addDays(iso: string, days: number): string {
  const date = parseIso(iso);
  date.setDate(date.getDate() + days);
  return isoFromDate(date);
}

export function mondayOf(iso: string): string {
  const day = parseIso(iso).getDay();
  return addDays(iso, day === 0 ? -6 : 1 - day);
}

export const weekDates = (weekStart: string): string[] =>
  Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

export function weekdayOf(iso: string): Weekday {
  const day = parseIso(iso).getDay();
  return (day === 0 ? 7 : day) as Weekday;
}

export const formatDay = (iso: string): string =>
  parseIso(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

export function formatWeekRange(weekStart: string): string {
  const short = (iso: string): string =>
    parseIso(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${short(weekStart)} - ${short(addDays(weekStart, 6))}`;
}
