// Pure checks for the drill editor, the drill list merge and the timer. Run with:
//   node scripts/run-harness.mjs
import {
  DEFAULT_DRILL_MINUTES,
  DRILL_MINUTES_MAX,
  drillDetails,
  drillFromDraft,
  drillPayload,
  drillSeconds,
  emptyDrillDraft,
  extendRemaining,
  formatClock,
  mergeDrills,
  parseDrillRow,
  parseDrillRows,
  remainingFromDeadline,
  summarizeDrill,
  timerProgress,
  toDrillRow,
  validateDrillDraft,
  withoutDrills,
  type Drill,
  type DrillDraft,
} from '../src/features/coach/drills/drills';
import { assertQueuedPayload } from '../src/core/sync/contracts';

async function main(): Promise<void> {
  const assert = (label: string, condition: boolean, extra?: unknown): void => {
    if (condition) {
      console.log(`ok   ${label}`);
    } else {
      console.error(`FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
      process.exitCode = 1;
    }
  };

  const draft = (over: Partial<DrillDraft> = {}): DrillDraft => ({ ...emptyDrillDraft(), ...over });

  // --- 1. reading rows off the server or the cache --------------------------------------

  const full = parseDrillRow({
    id: 'd-1',
    name: '  Rondo 4v2  ',
    focus: '  Passing ',
    details: { minutes: 15, notes: '  Two touches max  ' },
  });
  assert(
    'a complete row reads with trimmed text',
    full !== null && full.name === 'Rondo 4v2' && full.focus === 'Passing' && full.minutes === 15 && full.notes === 'Two touches max',
    full,
  );

  assert('a row without an id is dropped', parseDrillRow({ name: 'Rondo' }) === null);
  assert('a row without a name is dropped', parseDrillRow({ id: 'd-1', name: '   ' }) === null);
  assert('a blank focus reads as null', parseDrillRow({ id: 'd-1', name: 'Rondo', focus: '  ' })?.focus === null);

  const noDetails = parseDrillRow({ id: 'd-2', name: 'Shuttles' });
  assert('missing details fall back to the default length', noDetails?.minutes === DEFAULT_DRILL_MINUTES, noDetails);

  const wildMinutes = parseDrillRow({ id: 'd-3', name: 'Sprints', details: { minutes: 900 } });
  assert('a stored length is clamped to the maximum', wildMinutes?.minutes === DRILL_MINUTES_MAX, wildMinutes);
  const zeroMinutes = parseDrillRow({ id: 'd-4', name: 'Sprints', details: { minutes: 0 } });
  assert('a stored zero length is raised to the minimum', zeroMinutes?.minutes === 1, zeroMinutes);
  const textMinutes = parseDrillRow({ id: 'd-5', name: 'Sprints', details: { minutes: '20' } });
  assert('a numeric string length is read', textMinutes?.minutes === 20, textMinutes);

  const parsed = parseDrillRows([
    { id: 'b', name: 'Zonal', details: {} },
    { id: 'a', name: 'agility', details: { minutes: 5 } },
    { id: 'a', name: 'agility again', details: {} },
    { name: 'no id' },
    null,
  ]);
  assert(
    'the list sorts by name, keeps one row per id and counts the unreadable ones',
    parsed.drills.map(drill => drill.id).join(',') === 'a,b' && parsed.dropped === 2,
    parsed,
  );
  assert('a non-array reads as an empty list', parseDrillRows({ drills: [] }).drills.length === 0);

  const roundTrip = parseDrillRow(toDrillRow(full as Drill));
  assert(
    'toDrillRow survives the trip back through the parser',
    roundTrip !== null &&
      roundTrip.name === full?.name &&
      roundTrip.minutes === full?.minutes &&
      roundTrip.notes === full?.notes &&
      roundTrip.focus === full?.focus,
    roundTrip,
  );

  // --- 2. the editor -------------------------------------------------------------------

  assert('an empty draft is refused for having no name', validateDrillDraft(draft()) !== null);
  assert('a name alone is a valid drill', validateDrillDraft(draft({ name: 'Rondo' })) === null);
  assert('a 61-character name is refused', validateDrillDraft(draft({ name: 'x'.repeat(61) })) !== null);
  assert('zero minutes is refused', validateDrillDraft(draft({ name: 'Rondo', minutes: 0 })) !== null);
  assert('121 minutes is refused', validateDrillDraft(draft({ name: 'Rondo', minutes: 121 })) !== null);
  assert('a fractional minute is refused', validateDrillDraft(draft({ name: 'Rondo', minutes: 7.5 })) !== null);
  assert('120 minutes is accepted', validateDrillDraft(draft({ name: 'Rondo', minutes: 120 })) === null);

  const saved = drillFromDraft({ id: null, name: '  Pressing  ', focus: '  ', minutes: 12, notes: '  ' }, 'row-1');
  assert(
    'a saved draft is trimmed, with blanks as null',
    saved.name === 'Pressing' && saved.focus === null && saved.notes === null && saved.minutes === 12,
    saved,
  );

  const payload = drillPayload(saved, 'team-1');
  let contractProblem: string | null = null;
  try {
    assertQueuedPayload('drills', payload);
  } catch (error) {
    contractProblem = String(error);
  }
  assert('a drill payload satisfies the outbox contract', contractProblem === null, contractProblem);
  assert(
    'the payload carries the team, name and details json',
    payload.team_id === 'team-1' &&
      payload.name === 'Pressing' &&
      JSON.stringify(payload.details) === JSON.stringify({ minutes: 12 }),
    payload,
  );
  assert(
    'an empty note is left out of the details',
    Object.prototype.hasOwnProperty.call(drillDetails(10, '   '), 'notes') === false,
    drillDetails(10, '   '),
  );
  assert('a note is trimmed into the details', drillDetails(10, '  keep  ').notes === 'keep');

  assert('summarize names focus and minutes', summarizeDrill(saved) === '12 min', summarizeDrill(saved));
  assert(
    'summarize skips a missing focus',
    summarizeDrill({ ...saved, focus: 'Passing' }) === 'Passing - 12 min',
    summarizeDrill({ ...saved, focus: 'Passing' }),
  );

  // --- 3. merging the outbox over the server -------------------------------------------

  const server: Drill[] = [
    { id: 'a', name: 'Agility', focus: null, minutes: 5, notes: null },
    { id: 'b', name: 'Rondo', focus: null, minutes: 10, notes: null },
  ];
  const pending: Drill[] = [
    { id: 'b', name: 'Rondo', focus: 'Passing', minutes: 20, notes: null },
    { id: 'c', name: 'Zonal', focus: null, minutes: 8, notes: null },
  ];
  const merged = mergeDrills(server, pending);
  assert(
    'a queued drill wins over the server copy',
    merged.find(drill => drill.id === 'b')?.minutes === 20,
    merged,
  );
  assert('a drill only on this phone is kept', merged.some(drill => drill.id === 'c'), merged);
  assert('the merged list stays alphabetical', merged.map(drill => drill.id).join(',') === 'a,b,c', merged);

  const hidden = withoutDrills(server, new Set(['b']));
  assert(
    'a queued delete hides the server row until it flushes',
    hidden.map(drill => drill.id).join(',') === 'a',
    hidden,
  );
  assert('a queued delete leaves nothing else behind', withoutDrills(server, new Set()).length === 2);

  const afterDelete = mergeDrills(withoutDrills(server, new Set(['b'])), []);
  assert(
    'the training list does not bring back a drill whose delete is still queued',
    afterDelete.map(drill => drill.id).join(',') === 'a',
    afterDelete,
  );

  // --- 4. the timer --------------------------------------------------------------------

  assert('a 10 minute drill is 600 seconds', drillSeconds(10) === 600);
  assert('the clock formats whole minutes', formatClock(600) === '10:00');
  assert('the clock pads the seconds', formatClock(59) === '0:59');
  assert('the clock ends at zero', formatClock(0) === '0:00');
  assert('a negative clock reads as zero', formatClock(-4) === '0:00');
  assert('past an hour the clock keeps counting minutes', formatClock(3661) === '61:01');

  assert('a deadline rounds up to the next whole second', remainingFromDeadline(10_000, 9_001) === 1);
  assert('a deadline in the future keeps its seconds', remainingFromDeadline(10_000, 4_000) === 6);
  assert('a passed deadline is zero, not negative', remainingFromDeadline(10_000, 12_000) === 0);

  assert('adding a minute moves the clock forward', extendRemaining(540, 60) === 600);
  assert('adding past the maximum stops at 120 minutes', extendRemaining(7200, 60) === 7200);
  assert('extending never goes below zero', extendRemaining(0, -60) === 0);

  assert('a full clock has no progress', timerProgress(600, 600) === 0);
  assert('a finished drill is full progress', timerProgress(0, 600) === 1);
  assert('a half-run drill is half progress', timerProgress(300, 600) === 0.5);
  assert('a zero-length drill reads as complete', timerProgress(0, 0) === 1);

  console.log(process.exitCode ? '\nSOME DRILL CHECKS FAILED' : '\nall drill checks passed');
}

export const done = main();
