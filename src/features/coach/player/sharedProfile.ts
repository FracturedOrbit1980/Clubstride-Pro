import { parseScores, type Scores } from './assessment';
import { summariseMinutes, type MatchMinutesSummary, type PlayerMatchEntry } from './minutes';

/**
 * The public shape returned by `player_profile_by_code()`: exactly one child's report, read
 * with a code so no account and no table privilege is involved. Parsed rather than trusted,
 * because this is the only data in the app that arrives for a visitor who is not signed in.
 */

export interface SharedPlayer {
  id: string;
  fullName: string;
  shirtNumber: number;
  position: string | null;
  teamName: string;
}

export interface SharedProfile {
  player: SharedPlayer;
  scores: Scores;
  coachNotes: string | null;
  recordedAt: string | null;
  /** Completed matches, newest first, so the shared page lists game time the same way. */
  entries: PlayerMatchEntry[];
  summary: MatchMinutesSummary;
  generatedAt: string | null;
}

export interface ParsedSharedProfile {
  profile: SharedProfile | null;
  /** Match rows the function returned that could not be read. */
  dropped: number;
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const whole = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

const timestamp = (value: unknown): string | null => {
  const raw = text(value);
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Shape alone would accept 2026-13-40 and sort it above October, so the day has to exist. */
const isCalendarDate = (value: string): boolean => {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};


export function parseSharedProfile(value: unknown): ParsedSharedProfile {
  const root = record(value);
  const player = root ? record(root.player) : null;
  if (!root || !player) return { profile: null, dropped: 0 };

  const id = text(player.id);
  const fullName = text(player.full_name);
  const shirtNumber = whole(player.shirt_number);
  if (!id || !fullName || shirtNumber === null) return { profile: null, dropped: 0 };

  const assessment = record(root.assessment);
  const minutes = record(root.minutes);
  const rows = minutes && Array.isArray(minutes.matches) ? minutes.matches : [];

  let dropped = 0;
  const entries: PlayerMatchEntry[] = [];
  for (const row of rows) {
    const match = record(row);
    const matchId = match ? text(match.match_id) : '';
    const matchDate = match ? text(match.match_date) : '';
    const teamSeconds = match ? whole(match.duration_seconds) : null;
    const played = match ? whole(match.played_seconds) : null;
    if (!matchId || !isCalendarDate(matchDate) || teamSeconds === null || played === null) {
      dropped += 1;
      continue;
    }
    // The function already clamps, but a shared page must not print "90 min" for a 60 min match.
    const playedSeconds = teamSeconds > 0 ? Math.min(played, teamSeconds) : played;
    entries.push({
      matchId,
      title: text(match?.title) || 'Match',
      matchDate,
      opponentName: text(match?.opponent_name),
      teamSeconds,
      playedSeconds,
      listedAs: playedSeconds > 0 ? 'starter' : null,
      recordedAt: timestamp(match?.recorded_at) ?? matchDate,
    });
  }
  entries.sort((a, b) => (a.matchDate === b.matchDate ? 0 : a.matchDate < b.matchDate ? 1 : -1));

  return {
    profile: {
      player: {
        id,
        fullName,
        shirtNumber,
        position: text(player.position_tag) || null,
        teamName: text(player.team_name) || 'Clubstride',
      },
      scores: assessment ? parseScores(assessment.scores) : {},
      coachNotes: assessment ? text(assessment.coach_notes).slice(0, 2000) || null : null,
      recordedAt: assessment ? timestamp(assessment.recorded_at) : null,
      entries,
      summary: summariseMinutes(entries),
      generatedAt: timestamp(root.generated_at),
    },
    dropped,
  };
}
