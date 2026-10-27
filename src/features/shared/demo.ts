import type { Membership } from '../../core/context/AuthContext';
import type { AttendanceRow, AttendanceStatus } from '../coach/attendance/attendance';
import type { SquadPlayerRow } from '../coach/attendance/squad';
import { sessionsInWeek, type TrainingSettings } from '../coach/attendance/trainingDays';
import type { Drill } from '../coach/drills/drills';

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
  for (const date of sessionsInWeek(weekStart, DEMO_TRAINING.days)) {
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
