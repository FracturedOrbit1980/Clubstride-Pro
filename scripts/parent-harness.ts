// Pure checks for what a parent's overview tells a family. Run with the other harnesses:
//   node scripts/run-harness.mjs
import { indexAttendance, summariseAttendance } from '../src/features/coach/attendance/attendance';
import { METRICS, categoryAverages } from '../src/features/coach/player/assessment';
import { mondayOf } from '../src/features/coach/attendance/week';
import { DEMO_PLAYERS, demoAssessment, demoAttendanceSeason } from '../src/features/shared/demo';
import {
  markedSessions,
  nextTraining,
  ratedText,
  seasonRunText,
  statusBreakdown,
  weekSessions,
} from '../src/features/parent/overview';

async function main(): Promise<void> {
  const assert = (label: string, condition: boolean, extra?: unknown): void => {
    if (condition) {
      console.log(`ok   ${label}`);
    } else {
      console.error(`FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
      process.exitCode = 1;
    }
  };

  const today = '2026-11-05';
  const weekStart = mondayOf(today);
  const child = DEMO_PLAYERS[0];
  const map = demoAttendanceSeason(today);
  const week = weekSessions(child.id, map, weekStart, [1, 3, 5]);

  // Thursday 5 November 2026, so this week's training days are Monday 2nd, Wednesday 4th, Friday 6th.
  assert('the week lists only the days this squad trains', week.length === 3, week.map(row => row.date));
  assert(
    'the week is in calendar order',
    week.map(row => row.date).join(',') === '2026-11-02,2026-11-04,2026-11-06',
    week.map(row => row.date),
  );

  const unmarked = week.find(row => row.date === '2026-11-06');
  assert('a session that has not happened yet has no mark', unmarked?.status === null, unmarked);
  assert(
    'a past session shows the mark the coach left',
    week.filter(row => row.status !== null).length === 2,
    week,
  );
  assert('the marked count agrees with the rows', markedSessions(week) === 2, markedSessions(week));
  assert('a parent is told when the next session is', nextTraining(week, today)?.date === '2026-11-06', nextTraining(week, today));
  assert('today is not its own next session', nextTraining([{ date: today, status: null }], today) === null);
  assert('a spent week has no next session', nextTraining(week, '2026-11-08') === null);

  const blank = weekSessions(child.id, indexAttendance([]), weekStart, [1, 3, 5]);
  assert('no rows at all leaves every session not marked, never absent', blank.every(row => row.status === null), blank);

  const season = summariseAttendance(child.id, map);
  assert('the season run counts marked sessions, not the calendar', seasonRunText(season).includes(`of ${season.sessions}`), seasonRunText(season));
  assert(
    'the season run names both numbers',
    seasonRunText(season) === `${season.attended} of ${season.sessions} marked sessions attended`,
    seasonRunText(season),
  );
  assert(
    'a season with no marks says so instead of a rate',
    seasonRunText(summariseAttendance('nobody', map)) === 'No training session has been marked for this child yet.',
    seasonRunText(summariseAttendance('nobody', map)),
  );
  const breakdown = statusBreakdown(season);
  assert('the breakdown lists what happened', breakdown.startsWith('Present') && !breakdown.includes('undefined'), breakdown);
  assert('a season of nothing marked has a breakdown to read', statusBreakdown(summariseAttendance('nobody', map)) === 'Nothing marked');

  const empty = ratedText({});
  assert('no ratings reads as unrated, not as a score of zero', empty === `None of the ${METRICS.length} skills has been rated yet.`, empty);
  const partial = ratedText({ passing_accuracy: 4, first_touch: 3 });
  assert('a partial set says how much of it is there', partial.startsWith('2 of 17 skills rated'), partial);
  assert('a rating is printed on the 1 to 5 scale, never as a percentage', !partial.includes('%'), partial);
  assert(
    'the mean of the ratings written down is the mean shown',
    partial.includes('Average of those ratings: 3.5 on the 1 to 5 scale'),
    partial,
  );
  const unrated = categoryAverages({ passing_accuracy: 4 });
  assert('a category nobody rated has no average to print', unrated.physical === null && unrated.technical === 4, unrated);

  const full = demoAssessment(child.id);
  assert(
    'a fully rated child reports all of it rated',
    ratedText(full.scores).startsWith(`${METRICS.length} of ${METRICS.length} skills rated`),
    ratedText(full.scores),
  );
  assert(
    'the feedback a family reads is the note on the assessment',
    full.coachNotes !== null && full.coachNotes.length > 0,
    full.coachNotes,
  );

  console.log(process.exitCode ? '\nSOME PARENT CHECKS FAILED' : '\nall parent checks passed');
}

export const done = main();
