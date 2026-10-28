// The row model mirrors public.attendance exactly, so the server read, the on-phone cache and
// the outbox payload all use the same field names and there is no mapping layer to drift.

export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused'] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  excused: 'Excused',
};

export const isAttendanceStatus = (value: unknown): value is AttendanceStatus =>
  typeof value === 'string' && (ATTENDANCE_STATUSES as readonly string[]).includes(value);

export interface AttendanceRow {
  id: string;
  player_id: string;
  session_date: string;
  status: AttendanceStatus;
  recorded_at: string;
}

/** Keyed by `playerId|sessionDate`: one practice row per player per day, which is the schema's
 * unique key too. */
export type AttendanceMap = Record<string, AttendanceRow>;

export const attendanceKey = (playerId: string, sessionDate: string): string => `${playerId}|${sessionDate}`;

export interface ParsedAttendance {
  rows: AttendanceRow[];
  dropped: number;
}

const toRow = (value: unknown): AttendanceRow | null => {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.player_id !== 'string') return null;
  if (typeof raw.session_date !== 'string' || typeof raw.recorded_at !== 'string') return null;
  if (!isAttendanceStatus(raw.status)) return null;
  return {
    id: raw.id,
    player_id: raw.player_id,
    session_date: raw.session_date,
    status: raw.status,
    recorded_at: raw.recorded_at,
  };
};

/** Malformed rows are counted, not silently dropped: a row that cannot be read is a visible
 * data problem, not an empty session. */
export function parseAttendanceRows(value: unknown): ParsedAttendance {
  if (value === null || value === undefined) return { rows: [], dropped: 0 };
  if (!Array.isArray(value)) return { rows: [], dropped: 1 };
  const rows: AttendanceRow[] = [];
  let dropped = 0;
  for (const item of value) {
    const row = toRow(item);
    if (row) rows.push(row);
    else dropped += 1;
  }
  return { rows, dropped };
}

export function indexAttendance(rows: readonly AttendanceRow[]): AttendanceMap {
  const map: AttendanceMap = {};
  for (const row of rows) {
    const key = attendanceKey(row.player_id, row.session_date);
    const existing = map[key];
    if (!existing || Date.parse(row.recorded_at) >= Date.parse(existing.recorded_at)) map[key] = row;
  }
  return map;
}

/**
 * Server rows over the local map, newest phone timestamp per row wins. A mark queued here
 * while offline is newer than the club's copy, so it survives the refresh; a correction made
 * by another coach later than this phone's mark wins instead.
 */
export function mergeAttendance(current: AttendanceMap, incoming: readonly AttendanceRow[]): AttendanceMap {
  const next: AttendanceMap = { ...current };
  for (const row of incoming) {
    const key = attendanceKey(row.player_id, row.session_date);
    const existing = next[key];
    if (!existing || Date.parse(row.recorded_at) >= Date.parse(existing.recorded_at)) next[key] = row;
  }
  return next;
}

export function withAttendance(map: AttendanceMap, row: AttendanceRow): AttendanceMap {
  return { ...map, [attendanceKey(row.player_id, row.session_date)]: row };
}

export interface StatusCounts {
  present: number;
  late: number;
  absent: number;
  excused: number;
  unmarked: number;
  total: number;
}

export function countStatuses(
  playerIds: readonly string[],
  map: AttendanceMap,
  sessionDate: string,
): StatusCounts {
  const counts: StatusCounts = { present: 0, late: 0, absent: 0, excused: 0, unmarked: 0, total: playerIds.length };
  for (const playerId of playerIds) {
    const entry = map[attendanceKey(playerId, sessionDate)];
    if (!entry) {
      counts.unmarked += 1;
      continue;
    }
    counts[entry.status] += 1;
  }
  return counts;
}

export const recordedCount = (counts: StatusCounts): number => counts.total - counts.unmarked;

/** Present plus late over the players who were marked at all. Null until something is marked. */
export function attendanceRate(counts: StatusCounts): number | null {
  const recorded = recordedCount(counts);
  if (recorded === 0) return null;
  return Math.round(((counts.present + counts.late) / recorded) * 100);
}

export function describeCounts(counts: StatusCounts): string {
  if (counts.total === 0) return 'No players';
  const parts = [`${counts.present} present`];
  if (counts.late > 0) parts.push(`${counts.late} late`);
  if (counts.absent > 0) parts.push(`${counts.absent} absent`);
  if (counts.excused > 0) parts.push(`${counts.excused} excused`);
  if (counts.unmarked > 0) parts.push(`${counts.unmarked} unmarked`);
  return parts.join(' · ');
}

/** One player across every session that has been marked for them, whatever the week. */
export interface AttendanceSummary {
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** Sessions with a mark: the denominator of `rate`, and the number beside the attended count. */
  sessions: number;
  /** Present plus late, the same definition of "attended" the register's rate uses. */
  attended: number;
  rate: number | null;
}

export function summariseAttendance(playerId: string, map: AttendanceMap): AttendanceSummary {
  const summary: AttendanceSummary = { present: 0, late: 0, absent: 0, excused: 0, sessions: 0, attended: 0, rate: null };
  for (const row of Object.values(map)) {
    if (row.player_id !== playerId) continue;
    summary[row.status] += 1;
    summary.sessions += 1;
  }
  if (summary.sessions === 0) return summary;
  summary.attended = summary.present + summary.late;
  summary.rate = Math.round((summary.attended / summary.sessions) * 100);
  return summary;
}
