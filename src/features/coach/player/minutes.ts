/**
 * Game time for one player, summed from the matches the team has finished. The denominator is
 * every completed match, not only the ones the player was picked for: "186 of 240" is the number
 * a parent reads as "how much of the season was my child on the pitch". A match still in progress
 * is left out, because its clock keeps growing and would drag the percentage down every week.
 */

export type MatchStatus = 'scheduled' | 'in_progress' | 'paused' | 'completed';

/** The columns of public.matches that game time needs; rows can be passed straight through. */
export interface MatchMinutesRow {
  id: string;
  title?: string | null;
  opponent_name: string;
  match_date: string;
  status: string;
  duration_seconds?: number | null;
  recorded_at: string;
  deleted_at?: string | null;
}

/** The columns of public.match_players that game time needs. */
export interface LineupMinutesRow {
  match_id: string;
  player_id: string;
  listed_as?: string | null;
  recorded_seconds?: number | null;
}

export type ListedAs = 'starter' | 'bench';

export interface PlayerMatchEntry {
  matchId: string;
  title: string;
  matchDate: string;
  opponentName: string;
  teamSeconds: number;
  playedSeconds: number;
  listedAs: ListedAs | null;
  recordedAt: string;
}

export interface MatchMinutesSummary {
  matches: number;
  matchesPlayed: number;
  playedSeconds: number;
  totalSeconds: number;
  /** 0..1, or null until at least one match has a recorded length. */
  percentage: number | null;
}

const whole = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

const listed = (value: unknown): ListedAs | null =>
  value === 'starter' || value === 'bench' ? value : null;

const isCompleted = (match: MatchMinutesRow): boolean =>
  match.status === 'completed' && !match.deleted_at;

/**
 * Newest match first, which is the order the profile list reads in. A player with no line-up row
 * still gets an entry: that match is exactly the one where they played zero minutes.
 */
export const buildMatchLog = (
  playerId: string,
  matches: readonly MatchMinutesRow[],
  lineup: readonly LineupMinutesRow[],
): PlayerMatchEntry[] => {
  const byMatch = new Map<string, LineupMinutesRow>();
  for (const row of lineup) {
    if (row.player_id === playerId) byMatch.set(row.match_id, row);
  }
  return matches
    .filter(isCompleted)
    .map(match => {
      const row = byMatch.get(match.id);
      const teamSeconds = whole(match.duration_seconds);
      const raw = whole(row?.recorded_seconds);
      // A phone that kept counting after the whistle must not read as more than the match.
      const playedSeconds = teamSeconds > 0 ? Math.min(raw, teamSeconds) : raw;
      return {
        matchId: match.id,
        title: (match.title ?? '').trim() || 'Match',
        matchDate: match.match_date,
        opponentName: (match.opponent_name ?? '').trim(),
        teamSeconds,
        playedSeconds,
        listedAs: listed(row?.listed_as),
        recordedAt: match.recorded_at,
      };
    })
    .sort((a, b) => (a.matchDate === b.matchDate ? 0 : a.matchDate < b.matchDate ? 1 : -1));
};

/**
 * match_players has no version column, so freshness is judged by the parent match's recorded_at.
 * The minutes entry writes the match row alongside the line-up, which moves that stamp; without
 * it an edit made on one phone could lose to a stale server copy on another.
 */
export const mergeMatchLog = (...sources: readonly PlayerMatchEntry[][]): PlayerMatchEntry[] => {
  const merged = new Map<string, PlayerMatchEntry>();
  for (const source of sources) {
    for (const entry of source) {
      const existing = merged.get(entry.matchId);
      if (!existing || entry.recordedAt >= existing.recordedAt) merged.set(entry.matchId, entry);
    }
  }
  return [...merged.values()].sort((a, b) =>
    a.matchDate === b.matchDate ? 0 : a.matchDate < b.matchDate ? 1 : -1,
  );
};

export const summariseMinutes = (entries: readonly PlayerMatchEntry[]): MatchMinutesSummary => {
  let playedSeconds = 0;
  let totalSeconds = 0;
  let matchesPlayed = 0;
  for (const entry of entries) {
    playedSeconds += entry.playedSeconds;
    totalSeconds += entry.teamSeconds;
    if (entry.playedSeconds > 0) matchesPlayed += 1;
  }
  return {
    matches: entries.length,
    matchesPlayed,
    playedSeconds,
    totalSeconds,
    percentage: totalSeconds > 0 ? Math.min(1, playedSeconds / totalSeconds) : null,
  };
};

/** '45 min', or '6h 05m' once a season's worth adds up. Rounded down: a coach logs whole minutes. */
export const formatMinutes = (seconds: number): string => {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${(minutes % 60).toString().padStart(2, '0')}m`;
};

export const formatPercentage = (percentage: number | null): string =>
  percentage === null ? '-' : `${Math.round(percentage * 100)}%`;

/** The one phrase the profile screen and the PDF share, so the two can never disagree. */
export const gameTimeText = (summary: MatchMinutesSummary): string => {
  if (summary.totalSeconds === 0) return 'No match time recorded yet';
  return `${formatMinutes(summary.playedSeconds)} of ${formatMinutes(summary.totalSeconds)} (${formatPercentage(summary.percentage)})`;
};

/** Minutes for the entry list: '72 min', or 'Not in the squad' where there was no line-up row. */
export const entryMinutesText = (entry: PlayerMatchEntry): string =>
  entry.listedAs === null && entry.playedSeconds === 0 ? 'Not in the squad' : formatMinutes(entry.playedSeconds);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const optionalText = (value: unknown): string | null => text(value) || null;
const optionalNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
const timestamp = (value: unknown): string | null => {
  const raw = text(value);
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
};

export interface ParsedMatchRows {
  rows: MatchMinutesRow[];
  dropped: number;
}

/**
 * Cached and server rows are the same shape, so one parser reads both. A row that cannot supply
 * a date or a version is dropped rather than guessed at: either would quietly distort the
 * denominator of every percentage on the profile.
 */
export const parseMatchRows = (value: unknown): ParsedMatchRows => {
  const list = Array.isArray(value) ? value : [];
  const byId = new Map<string, MatchMinutesRow>();
  let dropped = 0;
  for (const entry of list) {
    const raw = record(entry);
    const id = text(raw?.id);
    const matchDate = text(raw?.match_date);
    const recordedAt = timestamp(raw?.recorded_at);
    const opponentName = text(raw?.opponent_name);
    if (!raw || !id || !ISO_DATE.test(matchDate) || !recordedAt || !opponentName) {
      dropped += 1;
      continue;
    }
    const row: MatchMinutesRow = {
      id,
      title: optionalText(raw.title),
      opponent_name: opponentName,
      match_date: matchDate,
      status: text(raw.status) || 'scheduled',
      duration_seconds: optionalNumber(raw.duration_seconds),
      recorded_at: recordedAt,
      deleted_at: timestamp(raw.deleted_at),
    };
    const existing = byId.get(id);
    if (!existing || row.recorded_at >= existing.recorded_at) byId.set(id, row);
  }
  return { rows: [...byId.values()], dropped };
};

export interface ParsedLineupRows {
  rows: LineupMinutesRow[];
  dropped: number;
}

/** One row per (match, player); a queued copy off the outbox wins when both are read. */
export const parseLineupRows = (value: unknown): ParsedLineupRows => {
  const list = Array.isArray(value) ? value : [];
  const byKey = new Map<string, LineupMinutesRow>();
  let dropped = 0;
  for (const entry of list) {
    const raw = record(entry);
    const matchId = text(raw?.match_id);
    const playerId = text(raw?.player_id);
    if (!raw || !matchId || !playerId) {
      dropped += 1;
      continue;
    }
    byKey.set(`${matchId}:${playerId}`, {
      match_id: matchId,
      player_id: playerId,
      listed_as: listed(raw.listed_as),
      recorded_seconds: optionalNumber(raw.recorded_seconds),
    });
  }
  return { rows: [...byKey.values()], dropped };
};
