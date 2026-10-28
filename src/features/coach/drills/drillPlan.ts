/**
 * A drill plan is the coaching detail behind a drill: how to set it out, the movement drawn on a
 * pitch, the order it happens in and what the coach watches for. It rides inside the
 * `details` JSONB column of public.drills, so a diagram needs no migration and survives a coach
 * editing the name, the focus or the timer.
 *
 * Positions are fractions of the drawing box (0..1 on both axes) rather than metres. One plan
 * then scales from a 320 px phone to a tablet, and the picture stays readable at arm's length on
 * the touchline instead of being a to-scale map nobody can see from the sideline.
 */

export const DRILL_AREAS = ['grid', 'channel', 'half', 'box'] as const;
export type DrillArea = (typeof DRILL_AREAS)[number];

/**
 * Where each area's outline is drawn inside the box, as fractions. The diagram renders its
 * furniture from these and a plan's marks are checked against them, so a player can never be
 * parked outside the area they are supposed to be standing in.
 */
export const DRILL_AREA_BOUNDS: Record<DrillArea, { left: number; top: number; right: number; bottom: number }> = {
  grid: { left: 0.06, top: 0.08, right: 0.94, bottom: 0.92 },
  channel: { left: 0.04, top: 0.2, right: 0.96, bottom: 0.8 },
  half: { left: 0.045, top: 0.06, right: 0.955, bottom: 0.94 },
  box: { left: 0.04, top: 0.06, right: 0.96, bottom: 0.94 },
};

export const DRILL_MARK_KINDS = ['cone', 'player', 'ball', 'goal'] as const;
export type DrillMarkKind = (typeof DRILL_MARK_KINDS)[number];

/** Who a player mark belongs to, which is the only colour decision a diagram needs. */
export const DRILL_SIDES = ['att', 'def', 'keeper'] as const;
export type DrillSide = (typeof DRILL_SIDES)[number];

/** Passes are dashed, movement is solid; a shot is drawn heavier because it ends the drill. */
export const DRILL_ROUTE_KINDS = ['pass', 'run', 'dribble', 'shot'] as const;
export type DrillRouteKind = (typeof DRILL_ROUTE_KINDS)[number];

export interface DrillPoint {
  x: number;
  y: number;
}

export interface DrillLeg {
  from: DrillPoint;
  to: DrillPoint;
}

export interface DrillMark {
  at: DrillPoint;
  kind: DrillMarkKind;
  /** The letter a coach reads out: A, W, 9, X. Cones and goals ignore it. */
  label?: string;
  side?: DrillSide;
}

export interface DrillRoute {
  kind: DrillRouteKind;
  /** Two or more waypoints, walked in order. */
  path: DrillPoint[];
  /** A ball circuit returns to its first waypoint; a run finishes and waits for the next round. */
  closed?: boolean;
}

export interface DrillPlan {
  /** The pitch furniture drawn behind the marks. */
  area: DrillArea;
  setup: string;
  marks: DrillMark[];
  routes: DrillRoute[];
  /** What happens, in the order the animation plays it. */
  steps: string[];
  /** What the coach watches for. */
  points: string[];
  /** The one change that makes it simpler and the one that makes it harder. */
  adjust: string;
}

export const DRILL_PLAN_SETUP_MAX = 240;
export const DRILL_PLAN_ADJUST_MAX = 320;
export const DRILL_PLAN_STEP_MAX = 200;
export const DRILL_PLAN_STEPS_MAX = 8;
export const DRILL_PLAN_POINTS_MAX = 6;
export const DRILL_PLAN_MARKS_MAX = 40;
export const DRILL_PLAN_ROUTES_MAX = 8;
export const DRILL_PLAN_ROUTE_POINTS_MAX = 10;

/** Metres of drawing box a marker covers per second: slow enough to follow, fast enough to loop. */
export const ROUTE_SPEED = 0.6;
/** The gap a route holds at its end before the cycle restarts, so the sequence stays readable. */
export const ROUTE_REST_SECONDS = 0.7;
const MIN_ROUTE_SECONDS = 0.35;

const fractionValue = (value: unknown): number | null => {
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(raw)) return null;
  return Math.min(1, Math.max(0, raw));
};

const pointValue = (value: unknown): DrillPoint | null => {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as { x?: unknown; y?: unknown };
  const x = fractionValue(raw.x);
  const y = fractionValue(raw.y);
  if (x === null || y === null) return null;
  return { x, y };
};

const textList = (value: unknown, cap: number, perItem: number): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    out.push(trimmed.slice(0, perItem));
    if (out.length >= cap) break;
  }
  return out;
};

const sentence = (value: unknown, limit: number): string => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, limit);
};

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;

const parseMark = (value: unknown): DrillMark | null => {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as { at?: unknown; kind?: unknown; label?: unknown; side?: unknown };
  const at = pointValue(raw.at);
  if (!at) return null;
  const mark: DrillMark = { at, kind: oneOf(raw.kind, DRILL_MARK_KINDS, 'cone') };
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 4) : '';
  if (label) mark.label = label;
  if (raw.side === 'att' || raw.side === 'def' || raw.side === 'keeper') mark.side = raw.side;
  return mark;
};

const parseRoute = (value: unknown): DrillRoute | null => {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as { kind?: unknown; path?: unknown; closed?: unknown };
  if (!Array.isArray(raw.path)) return null;
  const path: DrillPoint[] = [];
  for (const entry of raw.path) {
    const point = pointValue(entry);
    if (!point) continue;
    path.push(point);
    if (path.length >= DRILL_PLAN_ROUTE_POINTS_MAX) break;
  }
  if (path.length < 2) return null;
  const route: DrillRoute = { kind: oneOf(raw.kind, DRILL_ROUTE_KINDS, 'pass'), path };
  if (raw.closed === true) route.closed = true;
  return route;
};

/**
 * Reads whatever came out of the JSONB column, the cache or an outbox payload. Anything unusable
 * is dropped rather than guessed at, and a plan with nothing left to draw is no plan at all: the
 * drill still works, it just has no diagram.
 */
export function parseDrillPlan(value: unknown): DrillPlan | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as {
    area?: unknown;
    setup?: unknown;
    marks?: unknown;
    routes?: unknown;
    steps?: unknown;
    points?: unknown;
    adjust?: unknown;
  };
  const marks = Array.isArray(raw.marks)
    ? raw.marks
        .map(parseMark)
        .filter((mark): mark is DrillMark => mark !== null)
        .slice(0, DRILL_PLAN_MARKS_MAX)
    : [];
  const routes = Array.isArray(raw.routes)
    ? raw.routes
        .map(parseRoute)
        .filter((route): route is DrillRoute => route !== null)
        .slice(0, DRILL_PLAN_ROUTES_MAX)
    : [];
  const steps = textList(raw.steps, DRILL_PLAN_STEPS_MAX, DRILL_PLAN_STEP_MAX);
  const points = textList(raw.points, DRILL_PLAN_POINTS_MAX, DRILL_PLAN_STEP_MAX);
  const setup = sentence(raw.setup, DRILL_PLAN_SETUP_MAX);
  if (marks.length === 0 && routes.length === 0 && steps.length === 0) return null;
  return {
    area: oneOf(raw.area, DRILL_AREAS, 'grid'),
    setup,
    marks,
    routes,
    steps,
    points,
    adjust: sentence(raw.adjust, DRILL_PLAN_ADJUST_MAX),
  };
}

// --- drawing -------------------------------------------------------------------------------

const distance = (a: DrillPoint, b: DrillPoint): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Waypoints joined in order, plus the leg back to the start when the route is a circuit. */
export function routeLegs(route: DrillRoute): DrillLeg[] {
  const legs: DrillLeg[] = [];
  for (let index = 0; index + 1 < route.path.length; index += 1) {
    legs.push({ from: route.path[index]!, to: route.path[index + 1]! });
  }
  const last = route.path[route.path.length - 1];
  const first = route.path[0];
  if (route.closed && last && first && route.path.length > 2) legs.push({ from: last, to: first });
  return legs;
}

export const routeLength = (route: DrillRoute): number =>
  routeLegs(route).reduce((total, leg) => total + distance(leg.from, leg.to), 0);

export const legMidpoint = (leg: DrillLeg): DrillPoint => ({
  x: (leg.from.x + leg.to.x) / 2,
  y: (leg.from.y + leg.to.y) / 2,
});

/** A point on the route at `fraction` of its whole length, so legs are weighted by distance. */
export function pointAlongRoute(route: DrillRoute, fraction: number): DrillPoint {
  const end = route.path[route.path.length - 1] ?? route.path[0] ?? { x: 0, y: 0 };
  const legs = routeLegs(route);
  if (legs.length === 0) return end;
  const total = routeLength(route);
  if (total <= 0) return legs[0]!.from;
  const target = Math.min(1, Math.max(0, fraction)) * total;
  let covered = 0;
  for (const leg of legs) {
    const length = distance(leg.from, leg.to);
    if (covered + length >= target) {
      const along = length <= 0 ? 0 : (target - covered) / length;
      return { x: leg.from.x + (leg.to.x - leg.from.x) * along, y: leg.from.y + (leg.to.y - leg.from.y) * along };
    }
    covered += length;
  }
  return legs[legs.length - 1]!.to;
}

export const legIndexAlongRoute = (route: DrillRoute, fraction: number): number => {
  const legs = routeLegs(route);
  if (legs.length === 0) return 0;
  const total = routeLength(route);
  if (total <= 0) return 0;
  const target = Math.min(1, Math.max(0, fraction)) * total;
  let covered = 0;
  for (let index = 0; index < legs.length; index += 1) {
    const leg = legs[index]!;
    const length = distance(leg.from, leg.to);
    if (covered + length >= target) return index;
    covered += length;
  }
  return legs.length - 1;
};

const travelSeconds = (route: DrillRoute): number =>
  Math.max(MIN_ROUTE_SECONDS, routeLength(route) / ROUTE_SPEED);

export const routeRestSeconds = (route: DrillRoute): number => (route.closed ? 0 : ROUTE_REST_SECONDS);

export interface DrillCycle {
  /** When each route starts, in seconds from the top of the cycle. */
  starts: number[];
  /** How long the whole sequence takes before it loops. */
  seconds: number;
}

/**
 * Routes play one after another rather than all at once: a coach watching a ball, then a run, then
 * a shot learns the order, which is the part that is hard to describe in words.
 */
export function routeTimings(routes: readonly DrillRoute[]): DrillCycle {
  const starts: number[] = [];
  let cursor = 0;
  for (const route of routes) {
    starts.push(cursor);
    cursor += travelSeconds(route) + routeRestSeconds(route);
  }
  return { starts, seconds: cursor };
}

export interface MarkerState {
  /** Null while the route is still waiting for its turn in the cycle. */
  point: DrillPoint | null;
  fraction: number;
  leg: number;
  /** It has reached the end and holds there until the cycle restarts. */
  held: boolean;
}

export function markerState(routes: readonly DrillRoute[], index: number, elapsed: number): MarkerState {
  const waiting: MarkerState = { point: null, fraction: 0, leg: 0, held: false };
  const route = routes[index];
  if (!route || route.path.length < 2) return waiting;
  const { starts, seconds } = routeTimings(routes);
  if (seconds <= 0) return waiting;
  const start = starts[index] ?? 0;
  const local = Math.abs(elapsed) % seconds - start;
  if (local < 0) return waiting;
  const travel = travelSeconds(route);
  const fraction = travel <= 0 ? 1 : Math.min(1, local / travel);
  return {
    point: pointAlongRoute(route, fraction),
    fraction,
    leg: legIndexAlongRoute(route, fraction),
    held: fraction >= 1,
  };
}
