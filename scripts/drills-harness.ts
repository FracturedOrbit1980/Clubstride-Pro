// Pure checks for the drill editor, the drill list merge, the timer, the coaching library and the
// diagram animation. Run with:
//   node scripts/run-harness.mjs
import {
  DEFAULT_DRILL_MINUTES,
  DRILL_FOCUS_MAX,
  DRILL_MINUTES_MAX,
  DRILL_MINUTES_MIN,
  DRILL_NAME_MAX,
  draftFromDrill,
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
import {
  DRILL_AREA_BOUNDS,
  DRILL_PLAN_SETUP_MAX,
  DRILL_PLAN_STEPS_MAX,
  ROUTE_SPEED,
  markerState,
  parseDrillPlan,
  pointAlongRoute,
  routeLegs,
  routeLength,
  routeRestSeconds,
  routeTimings,
  type DrillPlan,
  type DrillPoint,
  type DrillRoute,
} from '../src/features/coach/drills/drillPlan';
import { DRILL_LIBRARY } from '../src/features/coach/drills/drillLibrary';
import { DEMO_DRILLS } from '../src/features/shared/demo';
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

  // Key order in a JSON string is not the point of a round trip, so compare plans field by field.
  const canonical = (value: unknown): string =>
    JSON.stringify(value, (_key, entry) =>
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.fromEntries(
            Object.entries(entry as Record<string, unknown>).sort(([left], [right]) => (left < right ? -1 : 1)),
          )
        : entry,
    );

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

  // --- 2. the diagram inside the same json column ----------------------------------------

  const withPlan = parseDrillRow({
    id: 'd-6',
    name: 'Rondo 4v2',
    details: {
      minutes: 15,
      plan: {
        area: 'grid',
        setup: 'Ten by ten, four out, two in.',
        marks: [{ at: { x: 0.5, y: 0.5 }, kind: 'cone' }],
        routes: [{ kind: 'pass', path: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }] }],
        steps: ['Pass and follow the ball.'],
        points: ['Open body shape.'],
        adjust: 'Two touches, then one.',
      },
    },
  });
  assert(
    'a plan in the details reads with its diagram',
    withPlan?.plan?.setup === 'Ten by ten, four out, two in.' && withPlan?.plan?.routes.length === 1,
    withPlan,
  );

  const junkPlan = parseDrillRow({
    id: 'd-7',
    name: 'Shuttles',
    details: { minutes: 8, plan: { area: 'grid', marks: [{ at: { x: 'wide', y: 5 }, kind: 'cone' }], routes: [{ kind: 'run', path: [{ x: 0.5, y: 0.5 }] }] } },
  });
  assert(
    'a drill whose plan cannot be drawn still reads, without a diagram',
    junkPlan !== null && junkPlan.plan === null && junkPlan.minutes === 8,
    junkPlan,
  );

  const planBack = parseDrillRow(toDrillRow(withPlan as Drill));
  assert('a plan survives its own row', canonical(planBack?.plan) === canonical(withPlan?.plan), planBack?.plan);
  assert(
    'a plan that cannot be drawn is never written into a row',
    drillDetails(10, null, { area: 'grid', setup: '', marks: [], routes: [], steps: [], points: [], adjust: '' } as DrillPlan)
      .plan === undefined,
    drillDetails(10, null, { area: 'grid', setup: '', marks: [], routes: [], steps: [], points: [], adjust: '' } as DrillPlan),
  );

  assert('junk is not a plan', parseDrillPlan(null) === null && parseDrillPlan([]) === null && parseDrillPlan('grid') === null);
  const clamped = parseDrillPlan({
    area: 'pitch',
    setup: 'x'.repeat(400),
    marks: [{ at: { x: -3, y: 5 }, kind: 'cone' }],
    routes: [],
    steps: Array.from({ length: 30 }, (_, index) => `step ${index}`),
    points: [],
    adjust: '',
  });
  assert('an off-scale position is pulled onto the drawing', clamped?.marks[0]?.at.x === 0 && clamped?.marks[0]?.at.y === 1, clamped?.marks);
  assert('an unknown area falls back to a cone grid', clamped?.area === 'grid', clamped?.area);
  assert('the set-up is cut to a readable length', clamped?.setup.length === DRILL_PLAN_SETUP_MAX, clamped?.setup.length);
  assert('a plan cannot grow past the step limit', clamped?.steps.length === DRILL_PLAN_STEPS_MAX, clamped?.steps.length);

  // --- 3. the editor -------------------------------------------------------------------

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

  // --- 4. merging the outbox over the server -------------------------------------------

  const server: Drill[] = [
    { id: 'a', name: 'Agility', focus: null, minutes: 5, notes: null, plan: null },
    { id: 'b', name: 'Rondo', focus: null, minutes: 10, notes: null, plan: null },
  ];
  const pending: Drill[] = [
    { id: 'b', name: 'Rondo', focus: 'Passing', minutes: 20, notes: null, plan: null },
    { id: 'c', name: 'Zonal', focus: null, minutes: 8, notes: null, plan: null },
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

  // --- 5. the timer --------------------------------------------------------------------

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

  // --- 6. the ten drills that ship with the app -------------------------------------------

  assert('the library carries ten drills', DRILL_LIBRARY.length === 10, DRILL_LIBRARY.length);
  assert('library ids are unique', new Set(DRILL_LIBRARY.map(drill => drill.id)).size === DRILL_LIBRARY.length);
  assert(
    'no two library drills share a name',
    new Set(DRILL_LIBRARY.map(drill => drill.name.toLowerCase())).size === DRILL_LIBRARY.length,
    DRILL_LIBRARY.map(drill => drill.name),
  );
  assert(
    'the library spans the game, not one corner of it',
    new Set(DRILL_LIBRARY.map(drill => drill.focus)).size >= 8,
    DRILL_LIBRARY.map(drill => drill.focus),
  );

  const libraryProblems: string[] = [];
  // A mark or a route drawn outside the area's outline looks like a broken picture on the
  // touchline, which is the one thing a coach is meant to be able to read at a glance.
  const offArea = (plan: DrillPlan, point: DrillPoint): boolean => {
    const b = DRILL_AREA_BOUNDS[plan.area];
    return point.x < b.left || point.x > b.right || point.y < b.top || point.y > b.bottom;
  };
  for (const drill of DRILL_LIBRARY) {
    if (drill.name.length > DRILL_NAME_MAX) libraryProblems.push(`${drill.id}: name over the limit`);
    if ((drill.focus ?? '').length > DRILL_FOCUS_MAX) libraryProblems.push(`${drill.id}: focus over the limit`);
    if (drill.minutes < DRILL_MINUTES_MIN || drill.minutes > DRILL_MINUTES_MAX) {
      libraryProblems.push(`${drill.id}: ${drill.minutes} minutes`);
    }
    // Coaching a drill from the library has to go through the same editor as a typed one.
    if (validateDrillDraft(draftFromDrill(drill)) !== null) libraryProblems.push(`${drill.id}: fails its own editor`);
    const plan = drill.plan as DrillPlan;
    if (!plan) {
      libraryProblems.push(`${drill.id}: no plan at all`);
      continue;
    }
    if (!plan.setup) libraryProblems.push(`${drill.id}: no set-up`);
    if (!plan.adjust) libraryProblems.push(`${drill.id}: no way to change it`);
    if (plan.steps.length < 3) libraryProblems.push(`${drill.id}: only ${plan.steps.length} steps`);
    if (plan.points.length < 2) libraryProblems.push(`${drill.id}: only ${plan.points.length} things to watch`);
    if (plan.marks.length < 3) libraryProblems.push(`${drill.id}: only ${plan.marks.length} marks to draw`);
    if (plan.routes.length < 1) libraryProblems.push(`${drill.id}: nothing moves`);
    if (!plan.marks.some(mark => mark.kind === 'player' && mark.side === 'att')) {
      libraryProblems.push(`${drill.id}: nobody in possession`);
    }
    for (const mark of plan.marks) {
      if (offArea(plan, mark.at)) {
        libraryProblems.push(`${drill.id}: ${mark.kind} ${mark.label ?? ''} sits outside its ${plan.area}`);
      }
    }
    for (const route of plan.routes) {
      if (route.path.some(point => offArea(plan, point))) {
        libraryProblems.push(`${drill.id}: a ${route.kind} route leaves its ${plan.area}`);
      }
      if (route.path.length < 2) libraryProblems.push(`${drill.id}: a route has one waypoint`);
      if (!(routeLength(route) > 0)) libraryProblems.push(`${drill.id}: a route goes nowhere`);
    }
    const stored = JSON.parse(JSON.stringify(drillDetails(drill.minutes, drill.notes, plan)));
    const reread = parseDrillRow({ id: drill.id, name: drill.name, details: stored })?.plan;
    if (canonical(reread) !== canonical(plan)) libraryProblems.push(`${drill.id}: does not survive its row`);
  }
  assert('every library drill can be run, drawn and stored as written', libraryProblems.length === 0, libraryProblems);

  const previewDrills = parseDrillRows(DEMO_DRILLS.map(toDrillRow));
  assert(
    'the preview squad drills keep their diagrams through the cache',
    previewDrills.dropped === 0 && previewDrills.drills.every(drill => drill.plan !== null),
    previewDrills.drills.map(drill => drill.plan === null),
  );

  // --- 7. the movement the diagram plays -------------------------------------------------

  const straight: DrillRoute = { kind: 'run', path: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
  const square: DrillRoute = {
    kind: 'pass',
    closed: true,
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  };
  assert('a straight route is one unit long', Math.abs(routeLength(straight) - 1) < 1e-9, routeLength(straight));
  assert('two waypoints make one leg', routeLegs(straight).length === 1);
  assert('a circuit adds the leg that comes home', routeLegs(square).length === 4, routeLegs(square).length);
  assert('a circuit never stops to breathe', routeRestSeconds(square) === 0 && routeRestSeconds(straight) > 0);
  assert('the start of a route is its first waypoint', pointAlongRoute(square, 0).x === 0);
  assert(
    'halfway round a circuit is the far side',
    pointAlongRoute(square, 0.5).x === 1 && pointAlongRoute(square, 0.5).y === 1,
    pointAlongRoute(square, 0.5),
  );
  assert('the end of a circuit is back where it began', pointAlongRoute(square, 1).x === 0);

  const inOrder = routeTimings([straight, square]);
  assert('the first route starts at once', inOrder.starts[0] === 0, inOrder);
  assert(
    'the second route waits for the first to finish',
    Math.abs(inOrder.starts[1] - (1 / ROUTE_SPEED + routeRestSeconds(straight))) < 1e-9,
    inOrder.starts,
  );
  assert(
    'the loop is the routes laid end to end',
    Math.abs(inOrder.seconds - (inOrder.starts[1] + 4 / ROUTE_SPEED)) < 1e-9,
    inOrder,
  );
  assert('a route that has not started shows no marker', markerState([straight, square], 1, 0).point === null);
  const midFirst = markerState([straight, square], 0, 1 / ROUTE_SPEED / 2);
  assert(
    'the marker is halfway along at half its time',
    midFirst.point !== null && Math.abs(midFirst.point.x - 0.5) < 1e-6 && midFirst.leg === 0,
    midFirst,
  );
  const pair = [square, straight];
  const pairCycle = routeTimings(pair);
  const late = markerState(pair, 1, pairCycle.seconds - 0.1);
  assert(
    'a finished run holds its end until the sequence loops',
    late.held === true && late.point?.x === 1,
    late,
  );
  assert(
    'the next round begins from the top',
    markerState(pair, 1, pairCycle.seconds + 0.05).point === null,
    markerState(pair, 1, pairCycle.seconds + 0.05),
  );

  const animationProblems: string[] = [];
  for (const drill of DRILL_LIBRARY) {
    const plan = drill.plan as DrillPlan;
    const cycle = routeTimings(plan.routes);
    if (!(cycle.seconds > 1 && cycle.seconds < 40)) {
      animationProblems.push(`${drill.id}: the loop runs ${cycle.seconds.toFixed(1)}s`);
    }
    for (let step = 0; step <= 40; step += 1) {
      plan.routes.forEach((_, index) => {
        const state = markerState(plan.routes, index, (cycle.seconds * step) / 40);
        if (!state.point) return;
        const { x, y } = state.point;
        if (![x, y].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1) {
          animationProblems.push(`${drill.id}: a marker leaves the drawing at ${step}`);
        }
      });
    }
  }
  assert('every animation stays on the page and loops in seconds', animationProblems.length === 0, animationProblems);

  console.log(process.exitCode ? '\nSOME DRILL CHECKS FAILED' : '\nall drill checks passed');
}

export const done = main();
