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
  teamName: 'Clubstride United',
  role: 'coach',
};

const player = (index: number, shirt: number, name: string, position: string): SquadPlayerRow => ({
  id: `preview-player-${index}`,
  full_name: name,
  shirt_number: shirt,
  position_tag: position,
  available: true,
});

export const DEMO_PLAYERS: SquadPlayerRow[] = [
  player(1, 1, 'Kwanele Dlamini', 'Goalkeeper'),
  player(2, 2, 'Sipho Mahlangu', 'Right Back'),
  player(3, 3, 'Daniel van Wyk', 'Centre Back'),
  player(4, 4, 'Thabo Nkosi', 'Centre Back'),
  player(5, 5, 'Marco Silva', 'Left Back'),
  player(6, 6, 'Liam Fischer', 'Defensive Midfielder'),
  player(7, 7, 'Alex Meyer', 'Midfielder'),
  player(8, 8, 'Aiden Pillay', 'Central Midfielder'),
  player(9, 9, 'Jordan Meyer', 'Striker'),
  player(10, 10, 'Sam Cele', 'Forward'),
  player(11, 11, 'Ethan Naidoo', 'Right Winger'),
  player(12, 12, 'Lerato Mokoena', 'Left Winger'),
  player(13, 13, 'Ruben Botha', 'Attacking Midfielder'),
  player(14, 14, 'Callum Petersen', 'Striker'),
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

/** Eleven present, one late, one excused and one absent: 12 of 14, the 86% the register shows. */
const DEMO_STATUSES: AttendanceStatus[] = [
  ...Array<AttendanceStatus>(11).fill('present'),
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
