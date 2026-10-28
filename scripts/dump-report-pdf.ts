// Dump the one-page player report the harness builds, to look at its layout as a real PDF.
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEMO_PLAYERS, DEMO_SHARE_CODE, demoAssessment, demoAttendanceSeason, demoMatchLog } from '../src/features/shared/demo';
import { summariseAttendance, indexAttendance } from '../src/features/coach/attendance/attendance';
import { summariseMinutes } from '../src/features/coach/player/minutes';
import { buildPlayerReportPdf } from '../src/features/coach/player/report';

mkdirSync('tmp', { recursive: true });

const player = DEMO_PLAYERS[0];
const statuses = ['present', 'present', 'present', 'present', 'present', 'present', 'present', 'late', 'excused', 'absent'] as const;
const season = summariseAttendance(
  player.id,
  indexAttendance(
    statuses.map((status, index) => ({
      id: `x${index}`,
      player_id: player.id,
      session_date: `2026-10-${String(5 + index).padStart(2, '0')}`,
      status,
      recorded_at: `2026-10-${String(5 + index).padStart(2, '0')}T16:00:00.000Z`,
    })),
  ),
);

const assessment = demoAssessment(player.id);

const input = {
  teamName: 'Clubstride FC',
  playerName: player.full_name,
  shirtNumber: player.shirt_number,
  position: player.position_tag,
  scores: assessment.scores,
  coachNotes: assessment.coachNotes,
  minutes: summariseMinutes(demoMatchLog(player.id)),
  attendance: season,
  shareCode: DEMO_SHARE_CODE,
  generatedAt: new Date(2026, 9, 27, 9, 30),
};

writeFileSync('tmp/report-full.pdf', buildPlayerReportPdf(input));
writeFileSync(
  'tmp/report-empty.pdf',
  buildPlayerReportPdf({
    ...input,
    attendance: summariseAttendance('nobody', {}),
    coachNotes: null,
    shareCode: null,
    scores: {},
  }),
);
console.log('wrote tmp/report-full.pdf and tmp/report-empty.pdf', season);

// What the signed-out preview now reports for each player, over an eight-week season.
const preview = demoAttendanceSeason('2026-10-28');
DEMO_PLAYERS.forEach(entry => {
  const s = summariseAttendance(entry.id, preview);
  console.log(`${entry.full_name}: ${s.attended}/${s.sessions} attended, ${s.rate}% (P${s.present} L${s.late} A${s.absent} E${s.excused})`);
});
writeFileSync(
  'tmp/report-preview.pdf',
  buildPlayerReportPdf({ ...input, attendance: summariseAttendance(DEMO_PLAYERS[5].id, preview), playerName: DEMO_PLAYERS[5].full_name }),
);
writeFileSync(
  'tmp/report-long.pdf',
  buildPlayerReportPdf({ ...input, coachNotes: 'Stay on the half-turn and pass first time when the press comes.'.repeat(14) }),
);
