// Pure checks for training days and attendance. Run with the outbox harness:
//   node scripts/run-harness.mjs
import { addDays, mondayOf, sessionToday, weekDates, weekdayOf } from '../src/features/coach/attendance/week';
import {
  formatTrainingDays,
  normalizeTrainingDays,
  parseTrainingSettings,
  pickNewerTrainingSettings,
  sessionsInWeek,
} from '../src/features/coach/attendance/trainingDays';
import {
  attendanceKey,
  attendanceRate,
  countStatuses,
  describeCounts,
  indexAttendance,
  mergeAttendance,
  parseAttendanceRows,
  withAttendance,
  type AttendanceMap,
  type AttendanceRow,
} from '../src/features/coach/attendance/attendance';
import { buildAttendanceRegisterHtml } from '../src/features/coach/attendance/register';
import { parseSquadRows } from '../src/features/coach/attendance/squad';
import { stableRowId, uuidV5 } from '../src/core/sync/stableId';
import { assertQueuedPayload } from '../src/core/sync/contracts';
import { coalesce } from '../src/core/sync/outbox';

async function main(): Promise<void> {
  const assert = (label: string, condition: boolean, extra?: unknown): void => {
    if (condition) {
      console.log(`ok   ${label}`);
    } else {
      console.error(`FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
      process.exitCode = 1;
    }
  };

  // --- 1. Monday-first week maths --------------------------------------------------------

  assert('Sunday belongs to the week that started six days earlier', mondayOf('2026-10-25') === '2026-10-19', mondayOf('2026-10-25'));
  assert('a Monday is its own week start', mondayOf('2026-10-19') === '2026-10-19');
  assert('a week has seven dates', weekDates('2026-10-19').length === 7);
  assert('the week ends on Sunday', weekDates('2026-10-19')[6] === '2026-10-25', weekDates('2026-10-19'));
  assert('weekday numbering is ISO (Mon=1, Sun=7)', weekdayOf('2026-10-19') === 1 && weekdayOf('2026-10-25') === 7);
  assert('weeks cross a year boundary', addDays('2026-12-31', 1) === '2027-01-01' && mondayOf('2027-01-01') === '2026-12-28', mondayOf('2027-01-01'));
  assert('today is an ISO date', /^\d{4}-\d{2}-\d{2}$/.test(sessionToday()), sessionToday());

  // --- 2. training days ------------------------------------------------------------------

  assert(
    'stored days are de-duplicated, sorted and range-checked',
    JSON.stringify(normalizeTrainingDays([3, 1, 3, 0, 8, '2', null])) === '[1,3]',
    normalizeTrainingDays([3, 1, 3, 0, 8, '2', null]),
  );
  assert('training days read back in weekday order', formatTrainingDays([5, 1, 3]) === 'Mon, Wed, Fri', formatTrainingDays([5, 1, 3]));
  assert('an empty set names itself', formatTrainingDays([]) === 'No training days set');
  assert(
    'only configured weekdays become sessions',
    JSON.stringify(sessionsInWeek('2026-10-19', [2, 4])) === JSON.stringify(['2026-10-20', '2026-10-22']),
    sessionsInWeek('2026-10-19', [2, 4]),
  );

  const cachedDays = parseTrainingSettings({ training_days: [5, 1], recorded_at: '2026-10-24T09:00:00.000Z' });
  assert('cached training settings keep their phone timestamp', cachedDays.days.join(',') === '1,5' && cachedDays.recordedAt === '2026-10-24T09:00:00.000Z', cachedDays);
  assert('no settings reads as an empty set', parseTrainingSettings(null).days.length === 0);

  const localNewer = pickNewerTrainingSettings(
    { days: [1], recordedAt: '2026-10-24T10:00:00.000Z' },
    { days: [1, 3], recordedAt: '2026-10-24T09:00:00.000Z' },
  );
  assert('a queued local edit is not overwritten by an older server copy', localNewer.days.join(',') === '1', localNewer);
  const remoteNewer = pickNewerTrainingSettings(
    { days: [1], recordedAt: '2026-10-24T08:00:00.000Z' },
    { days: [1, 3], recordedAt: '2026-10-24T09:00:00.000Z' },
  );
  assert('a newer server edit wins', remoteNewer.days.join(',') === '1,3', remoteNewer);
  const noTimestamp = pickNewerTrainingSettings({ days: [], recordedAt: null }, { days: [2], recordedAt: '2026-10-24T09:00:00.000Z' });
  assert('no local timestamp means the server copy wins', noTimestamp.days.join(',') === '2', noTimestamp);
  const localOnly = pickNewerTrainingSettings({ days: [6], recordedAt: '2026-10-24T10:00:00.000Z' }, { days: [], recordedAt: null });
  assert('a local edit survives when the club has no row yet', localOnly.days.join(',') === '6', localOnly);

  // --- 3. deterministic row ids ----------------------------------------------------------

  const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  assert('uuidv5 matches the published test vector', uuidV5('python.org', DNS) === '886313e1-3b8a-5372-9b90-0c9aee199e5d', uuidV5('python.org', DNS));

  const player = '11111111-1111-4111-8111-111111111111';
  const rowId = stableRowId('attendance', player, '2026-10-26', 'practice');
  assert(
    'an attendance row id is stable across phones',
    rowId === stableRowId('attendance', player, '2026-10-26', 'practice'),
    rowId,
  );
  assert('the stable id matches an independent uuidv5 implementation', rowId === '9fbc42fe-f615-547a-8f32-7490d6940fff', rowId);
  assert('different sessions get different ids', rowId !== stableRowId('attendance', player, '2026-10-27', 'practice'));
  assert('the id is a version-5 uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(rowId), rowId);

  // --- 4. reading, merging and counting attendance ---------------------------------------

  const serverRows: AttendanceRow[] = [
    { id: 'a1', player_id: 'p1', session_date: '2026-10-19', status: 'present', recorded_at: '2026-10-19T16:00:00.000Z' },
    { id: 'a2', player_id: 'p2', session_date: '2026-10-19', status: 'late', recorded_at: '2026-10-19T16:01:00.000Z' },
    { id: 'a3', player_id: 'p3', session_date: '2026-10-19', status: 'absent', recorded_at: '2026-10-19T16:02:00.000Z' },
  ];
  const parsed = parseAttendanceRows([
    ...serverRows,
    { id: 'bad', player_id: 'p4', session_date: '2026-10-19', status: 'maybe', recorded_at: 'x' },
  ]);
  assert('unreadable attendance rows are counted, not hidden', parsed.rows.length === 3 && parsed.dropped === 1, parsed);
  assert('an empty read is not a dropped row', parseAttendanceRows(null).dropped === 0);

  const map = indexAttendance(serverRows);
  assert('rows are keyed by player and date', map[attendanceKey('p1', '2026-10-19')]?.status === 'present');

  const staleServer = { ...serverRows[0]!, status: 'absent' as const, recorded_at: '2026-10-19T15:00:00.000Z' };
  const merged = mergeAttendance(map, [staleServer]);
  assert('an older server copy does not undo a newer local mark', merged[attendanceKey('p1', '2026-10-19')]?.status === 'present', merged[attendanceKey('p1', '2026-10-19')]);

  const newerServer = { ...serverRows[0]!, status: 'excused' as const, recorded_at: '2026-10-20T08:00:00.000Z' };
  const corrected = mergeAttendance(map, [newerServer]);
  assert('a newer server correction wins', corrected[attendanceKey('p1', '2026-10-19')]?.status === 'excused', corrected[attendanceKey('p1', '2026-10-19')]);

  const extra = { ...serverRows[0]!, id: 'a9', player_id: 'p9' };
  assert('server rows that are not cached yet are added', mergeAttendance(map, [extra])[attendanceKey('p9', '2026-10-19')]?.id === 'a9');
  assert('local rows absent from this week survive a refresh', Object.keys(mergeAttendance(map, [])).length === 3);

  const marked = withAttendance(map, {
    id: 'a4',
    player_id: 'p4',
    session_date: '2026-10-19',
    status: 'excused',
    recorded_at: '2026-10-19T16:03:00.000Z',
  });
  assert('marking replaces the row for that player and date', marked[attendanceKey('p4', '2026-10-19')]?.status === 'excused' && marked[attendanceKey('p1', '2026-10-19')]?.status === 'present');

  const counts = countStatuses(['p1', 'p2', 'p3', 'p4'], map, '2026-10-19');
  assert(
    'a session counts every status plus the unmarked players',
    counts.present === 1 && counts.late === 1 && counts.absent === 1 && counts.excused === 0 && counts.unmarked === 1 && counts.total === 4,
    counts,
  );
  assert('attendance rate treats late as attending and ignores unmarked players', attendanceRate(counts) === 67, attendanceRate(counts));
  assert('the summary names only statuses that occurred', describeCounts(counts) === '1 present · 1 late · 1 absent · 1 unmarked', describeCounts(counts));
  assert('nothing marked has no rate yet', attendanceRate(countStatuses(['p1'], {}, '2026-10-19')) === null);

  // --- 5. squad rows and the team_settings outbox contract -------------------------------

  const squad = parseSquadRows([
    { id: 'p2', full_name: 'Zane', shirt_number: 9, position_tag: null, available: true },
    { id: 'p1', full_name: 'Ayanda', shirt_number: 4, position_tag: 'CB', available: true },
    { id: 'bad', full_name: 'No number' },
  ]);
  assert('the squad is sorted by shirt number', squad.players[0]?.id === 'p1' && squad.players[1]?.id === 'p2', squad.players);
  assert('a malformed player is reported', squad.dropped === 1);

  const settingsInput = {
    table: 'team_settings' as const,
    rowId: 'team-1',
    op: 'upsert' as const,
    payload: { training_days: [1, 3], recorded_at: '2026-10-25T10:00:00.000Z' },
    requiresRowId: null,
    recordedAt: '2026-10-25T10:00:00.000Z',
  };
  assert('team_settings queues as one upsert per team', coalesce({ nextSeq: 1, entries: [] }, settingsInput).entries.length === 1);
  assertQueuedPayload('team_settings', settingsInput.payload);

  let rejected = '';
  try {
    coalesce({ nextSeq: 1, entries: [] }, { ...settingsInput, payload: { training_days: [1], recorded_by: 'u1', recorded_at: 'x' } });
  } catch (error) {
    rejected = String(error);
  }
  assert('team_settings refuses server-owned columns', rejected.includes('server-owned'), rejected);

  // --- 6. the attendance register PDF document -------------------------------------------

  const registerPlayers = [
    { id: 'p1', full_name: 'Alex Test', shirt_number: 7, position_tag: 'FWD', available: true },
    { id: 'p2', full_name: 'Sam Test', shirt_number: 4, position_tag: 'MID', available: true },
    { id: 'p3', full_name: 'Jo Test', shirt_number: 1, position_tag: 'GK', available: true },
  ];
  const registerSessions = ['2026-10-19', '2026-10-21', '2026-10-23'];
  let registerMap: AttendanceMap = {};
  const addMark = (playerId: string, sessionDate: string, status: AttendanceRow['status']): void => {
    registerMap = withAttendance(registerMap, {
      id: `row-${playerId}-${sessionDate}`,
      player_id: playerId,
      session_date: sessionDate,
      status,
      recorded_at: '2026-10-23T18:00:00.000Z',
    });
  };
  addMark('p1', '2026-10-19', 'present');
  addMark('p1', '2026-10-21', 'late');
  addMark('p1', '2026-10-23', 'absent');
  addMark('p2', '2026-10-19', 'present');
  addMark('p2', '2026-10-21', 'present');
  addMark('p3', '2026-10-19', 'absent');
  addMark('p3', '2026-10-21', 'excused');

  const registerHtml = buildAttendanceRegisterHtml({
    teamName: 'Clubstride FC',
    weekStart: '2026-10-19',
    trainingDays: [1, 3, 5],
    sessions: registerSessions,
    players: registerPlayers,
    records: registerMap,
    generatedAt: new Date(2026, 9, 23, 18, 5),
  });
  const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

  assert('the register names the squad and the week', registerHtml.includes('Clubstride FC') && registerHtml.includes('Week of 2026-10-19'));
  assert(
    'the register spells the training days out',
    registerHtml.includes('Training days: Mon, Wed, Fri') && registerHtml.includes('MON 19 OCT') && registerHtml.includes('WED 21 OCT') && registerHtml.includes('FRI 23 OCT'),
  );
  assert('every player appears in shirt-number order', ['#7', '#4', '#1'].every(token => registerHtml.includes(token)) && registerHtml.indexOf('#7') < registerHtml.indexOf('#4'));
  assert('each mark is rendered in its own session cell', occurrences(registerHtml, '>P</td>') === 3 && occurrences(registerHtml, '>L</td>') === 1 && occurrences(registerHtml, '>A</td>') === 2 && occurrences(registerHtml, '>E</td>') === 1);
  assert('unmarked sessions stay visibly unmarked', occurrences(registerHtml, '<td class="mark unmarked">-</td>') === 2);
  assert('the header counts marks out of every expected mark', registerHtml.includes('<b>7/9</b>') && registerHtml.includes('<b>57%</b>'));
  assert('the session summary matches the marks', registerHtml.includes('2 present') && registerHtml.includes('0 present') && registerHtml.includes('67% attended') && registerHtml.includes('0% attended'));
  assert('the generated timestamp is fixed for the export', registerHtml.includes('Generated 2026-10-23 18:05'));
  assert(
    'names are HTML-escaped, not injected',
    buildAttendanceRegisterHtml({
      teamName: 'A & B <FC>',
      weekStart: '2026-10-19',
      trainingDays: [1],
      sessions: ['2026-10-19'],
      players: [{ id: 'px', full_name: "O'Brien <script>alert(1)</script>", shirt_number: 9, position_tag: null, available: true }],
      records: {},
      generatedAt: new Date(2026, 9, 23, 18, 5),
    }).includes('A &amp; B &lt;FC&gt;') &&
      buildAttendanceRegisterHtml({
        teamName: 'A & B <FC>',
        weekStart: '2026-10-19',
        trainingDays: [1],
        sessions: ['2026-10-19'],
        players: [{ id: 'px', full_name: "O'Brien <script>alert(1)</script>", shirt_number: 9, position_tag: null, available: true }],
        records: {},
        generatedAt: new Date(2026, 9, 23, 18, 5),
      }).includes('O&#39;Brien &lt;script&gt;alert(1)&lt;/script&gt;'),
  );
  const emptyRegister = buildAttendanceRegisterHtml({
    teamName: 'Clubstride FC',
    weekStart: '2026-10-19',
    trainingDays: [],
    sessions: [],
    players: registerPlayers,
    records: {},
    generatedAt: new Date(2026, 9, 23, 18, 5),
  });
  assert('a week without training explains itself instead of printing an empty table', emptyRegister.includes('No training days are set for this week') && !emptyRegister.includes('<table>'));
  const rebuilt = buildAttendanceRegisterHtml({
    teamName: 'Clubstride FC',
    weekStart: '2026-10-19',
    trainingDays: [1, 3, 5],
    sessions: registerSessions,
    players: registerPlayers,
    records: registerMap,
    generatedAt: new Date(2026, 9, 23, 18, 5),
  });
  assert('the same register exports byte-for-byte the same document', rebuilt === registerHtml);

  console.log(process.exitCode ? '\nSOME ATTENDANCE CHECKS FAILED' : '\nall attendance checks passed');
}

export const done = main();
