import type { Membership } from '../../core/context/AuthContext';
import type { AttendanceRow, AttendanceStatus } from '../coach/attendance/attendance';
import type { SquadPlayerRow } from '../coach/attendance/squad';
import { sessionsInWeek, type TrainingSettings } from '../coach/attendance/trainingDays';
import type { Drill } from '../coach/drills/drills';
import {
  METRICS,
  type PlayerAssessment,
  type Scores,
} from '../coach/player/assessment';
import {
  buildMatchLog,
  type LineupMinutesRow,
  type MatchMinutesRow,
  type PlayerMatchEntry,
} from '../coach/player/minutes';
import { normaliseShareCode } from '../coach/player/shareCode';

/**
 * The signed-out preview: the same screens, fed by a squad bundled with the app instead of the
 * club database. Ids are not UUIDs on purpose - nothing here can match a real team, so a preview
 * write can never reach the club even if something tried to sync it.
 */
export const DEMO_TEAM_ID = 'preview-team';
export const DEMO_USER_ID = 'preview-coach';

export const DEMO_MEMBERSHIP: Membership = {
  teamId: DEMO_TEAM_ID,
  teamName: 'Clubstride FC',
  role: 'coach',
};

const player = (index: number, shirt: number, name: string, position: string): SquadPlayerRow => ({
  id: `preview-player-${index}`,
  full_name: name,
  shirt_number: shirt,
  position_tag: position,
  available: true,
});

/** The ten players from Clubstride Lite, so the preview roster matches the squad people already know. */
export const DEMO_PLAYERS: SquadPlayerRow[] = [
  player(1, 1, 'Mateo Rossi', 'Goalkeeper'),
  player(2, 2, 'Axel Lindqvist', 'Defender'),
  player(3, 4, 'Julian Vance', 'Defender'),
  player(4, 5, 'Tariq Sterling', 'Defender'),
  player(5, 7, 'Kaelan Diaz', 'Forward'),
  player(6, 8, 'Leo De Jong', 'Midfielder'),
  player(7, 9, 'Noah Sinclair', 'Forward'),
  player(8, 10, 'Liam Vance', 'Midfielder'),
  player(9, 11, 'Sami Morales', 'Midfielder'),
  player(10, 14, 'Lucas Chen', 'Forward'),
];

export const DEMO_TRAINING: TrainingSettings = {
  days: [1, 3, 5],
  recordedAt: '2026-10-26T16:00:00.000Z',
};

/**
 * Tabs unmount on switch, so a day change saved in Settings has to outlive that screen or
 * Training and the register would disagree with it. Preview edits last for the session only.
 */
let previewTraining: TrainingSettings = DEMO_TRAINING;

export const previewTrainingSettings = (): TrainingSettings => previewTraining;

export const savePreviewTraining = (next: TrainingSettings): void => {
  previewTraining = next;
};

export const DEMO_DRILLS: Drill[] = [
  { id: 'preview-drill-1', name: 'Rondo 4v2', focus: 'Passing', minutes: 15, notes: 'Two touches maximum.' },
  { id: 'preview-drill-2', name: 'First-touch gates', focus: 'First touch', minutes: 12, notes: null },
  { id: 'preview-drill-3', name: 'Pressing 3v3', focus: 'Pressing', minutes: 10, notes: 'Trigger on the backward pass.' },
];

/** Seven present, one late, one excused and one absent: 8 of 10, the 80% the register shows. */
const DEMO_STATUSES: AttendanceStatus[] = [
  ...Array<AttendanceStatus>(7).fill('present'),
  'late',
  'excused',
  'absent',
];

/** Only sessions that have already happened get marks, so an open week is not pre-filled. */
export const demoAttendance = (weekStart: string, today: string): AttendanceRow[] => {
  const rows: AttendanceRow[] = [];
  for (const date of sessionsInWeek(weekStart, previewTraining.days)) {
    if (date > today) continue;
    DEMO_PLAYERS.forEach((entry, index) => {
      rows.push({
        id: `preview-attendance-${entry.id}-${date}`,
        player_id: entry.id,
        session_date: date,
        status: DEMO_STATUSES[index] ?? 'present',
        recorded_at: `${date}T16:00:00.000Z`,
      });
    });
  }
  return rows;
};

const DEMO_NOTES = [
  'Reads the game well. Next focus: receiving on the half-turn.',
  'Strong in the duels. Keep working on the first touch under pressure.',
  'Excellent attitude at training. Needs to scan earlier before the ball arrives.',
];

/**
 * Every preview player has a full assessment, so the radar is never empty. Half-step scores are
 * spread by player index rather than randomised: the same squad reads the same on every visit.
 */
export const demoAssessment = (playerId: string): PlayerAssessment => {
  const index = Math.max(
    0,
    DEMO_PLAYERS.findIndex(entry => entry.id === playerId),
  );
  const scores: Scores = {};
  METRICS.forEach((metric, metricIndex) => {
    scores[metric.key] = 1.5 + ((index + metricIndex * 2) % 8) * 0.5;
  });
  return {
    id: `preview-assessment-${playerId}`,
    playerId,
    scores,
    coachNotes: DEMO_NOTES[index % DEMO_NOTES.length] ?? null,
    recordedAt: '2026-10-20T17:00:00.000Z',
  };
};

/**
 * Four completed matches and one in progress. The unfinished one is deliberate: it proves the
 * percentage ignores a clock that is still running.
 */
export const DEMO_MATCHES: MatchMinutesRow[] = [
  {
    id: 'preview-match-1',
    title: 'League',
    opponent_name: 'Northside FC',
    match_date: '2026-09-27',
    status: 'completed',
    duration_seconds: 3600,
    recorded_at: '2026-09-27T10:30:00.000Z',
  },
  {
    id: 'preview-match-2',
    title: 'League',
    opponent_name: 'Riverside Athletic',
    match_date: '2026-10-04',
    status: 'completed',
    duration_seconds: 3600,
    recorded_at: '2026-10-04T10:30:00.000Z',
  },
  {
    id: 'preview-match-3',
    title: 'Cup',
    opponent_name: 'Hillside United',
    match_date: '2026-10-11',
    status: 'completed',
    duration_seconds: 3600,
    recorded_at: '2026-10-11T10:30:00.000Z',
  },
  {
    id: 'preview-match-4',
    title: 'League',
    opponent_name: 'Eastgate Rovers',
    match_date: '2026-10-18',
    status: 'completed',
    duration_seconds: 3600,
    recorded_at: '2026-10-18T10:30:00.000Z',
  },
  {
    id: 'preview-match-5',
    title: 'League',
    opponent_name: 'Park Rangers',
    match_date: '2026-10-25',
    status: 'in_progress',
    duration_seconds: 1800,
    recorded_at: '2026-10-25T10:00:00.000Z',
  },
];

export const DEMO_LINEUP: LineupMinutesRow[] = DEMO_MATCHES.filter(
  match => match.status === 'completed',
).flatMap((match, matchIndex) =>
  DEMO_PLAYERS.map((entry, playerIndex) => {
    const starter = (playerIndex + matchIndex) % 10 < 7;
    const minutes = starter
      ? 45 + ((playerIndex * 7 + matchIndex * 13) % 16)
      : (playerIndex * 11 + matchIndex * 5) % 25;
    return {
      match_id: match.id,
      player_id: entry.id,
      listed_as: starter ? 'starter' : 'bench',
      recorded_seconds: minutes * 60,
    };
  }),
);

export const demoMatchLog = (playerId: string): PlayerMatchEntry[] =>
  buildMatchLog(playerId, DEMO_MATCHES, DEMO_LINEUP);

/** Stable codes so the preview's share button and code entry can be tried without a backend. */
const PREVIEW_CODE_BASE = 24;

export const previewShareCode = (playerId: string): string => {
  const index = DEMO_PLAYERS.findIndex(entry => entry.id === playerId);
  return `PLAYER${PREVIEW_CODE_BASE + Math.max(0, index)}`;
};

export const DEMO_SHARE_CODE = previewShareCode('preview-player-1');

/** The reverse of previewShareCode, for the shared profile screen while signed out. */
export const previewSharedPlayer = (code: string): SquadPlayerRow | null => {
  const match = /^PLAYER(2[4-9]|3[0-3])$/.exec(normaliseShareCode(code));
  if (!match) return null;
  const index = Number(match[1]) - PREVIEW_CODE_BASE;
  return DEMO_PLAYERS[index] ?? null;
};
