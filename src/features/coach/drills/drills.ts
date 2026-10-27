/**
 * Drills are the coaching side of training: a named exercise the squad runs, with a timer the
 * coach starts on the pitch. The row lives in public.drills, whose `details` column is JSONB,
 * so the minutes and notes travel inside it rather than needing a migration for each field.
 */

export const DRILL_MINUTES_MIN = 1;
export const DRILL_MINUTES_MAX = 120;
/** Long enough for a warm-up, short enough that a mistyped 600 cannot run all session. */
export const DEFAULT_DRILL_MINUTES = 10;
export const DRILL_NAME_MAX = 60;
export const DRILL_FOCUS_MAX = 40;
export const DRILL_NOTES_MAX = 500;

export interface Drill {
  id: string;
  name: string;
  /** The part of the game it trains, e.g. "Passing". Null when the coach left it blank. */
  focus: string | null;
  minutes: number;
  notes: string | null;
}

/** The form's state. `id` is null until a new drill is minted a row id. */
export interface DrillDraft {
  id: string | null;
  name: string;
  focus: string;
  minutes: number;
  notes: string;
}

/** The shape public.drills holds, and the shape this phone caches. */
export interface DrillRow {
  id: string;
  name: string;
  focus: string | null;
  details: Record<string, unknown>;
}

const trimOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const clampMinutes = (value: unknown): number => {
  const minutes = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(minutes)) return DEFAULT_DRILL_MINUTES;
  return Math.min(DRILL_MINUTES_MAX, Math.max(DRILL_MINUTES_MIN, Math.round(minutes)));
};

export function parseDrillRow(value: unknown): Drill | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as { id?: unknown; name?: unknown; focus?: unknown; details?: unknown };
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  const name = trimOrNull(raw.name);
  if (!name) return null;
  const details =
    typeof raw.details === 'object' && raw.details !== null
      ? (raw.details as { minutes?: unknown; notes?: unknown })
      : {};
  return {
    id: raw.id,
    name: name.slice(0, DRILL_NAME_MAX),
    focus: trimOrNull(raw.focus),
    minutes: clampMinutes(details.minutes),
    notes: trimOrNull(details.notes),
  };
}

const byName = (a: Drill, b: Drill): number => {
  const left = a.name.toLowerCase();
  const right = b.name.toLowerCase();
  if (left !== right) return left < right ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

export function sortDrills(drills: readonly Drill[]): Drill[] {
  return [...drills].sort(byName);
}

/**
 * Reads the server read or the on-phone cache. A row without an id or a name is dropped and
 * counted, because silently hiding a coach's drill is worse than saying one could not be read.
 */
export function parseDrillRows(value: unknown): { drills: Drill[]; dropped: number } {
  if (!Array.isArray(value)) return { drills: [], dropped: 0 };
  const seen = new Set<string>();
  const drills: Drill[] = [];
  let dropped = 0;
  for (const row of value) {
    const drill = parseDrillRow(row);
    if (!drill) {
      dropped += 1;
      continue;
    }
    // A repeated id is the same drill arriving twice; the list is already showing it.
    if (seen.has(drill.id)) continue;
    seen.add(drill.id);
    drills.push(drill);
  }
  return { drills: sortDrills(drills), dropped };
}

/**
 * A drill edited on this phone must stay visible while its row is still in the outbox, or the
 * next server read would hide it until the coach finds signal. Pending rows win over the
 * server's copy and are added when the server has never heard of them.
 */
export function mergeDrills(server: readonly Drill[], pending: readonly Drill[]): Drill[] {
  const byId = new Map(server.map(drill => [drill.id, drill] as const));
  for (const drill of pending) byId.set(drill.id, drill);
  return sortDrills([...byId.values()]);
}

/**
 * A drill deleted on this phone is still on the server until the tombstone flushes, so the
 * next read would bring it back and the delete would look undone.
 */
export function withoutDrills(drills: readonly Drill[], removed: ReadonlySet<string>): Drill[] {
  return drills.filter(drill => !removed.has(drill.id));
}

export const drillDetails = (minutes: number, notes: string | null): Record<string, unknown> => {
  const details: Record<string, unknown> = { minutes: clampMinutes(minutes) };
  const clean = notes === null ? null : notes.trim();
  if (clean) details.notes = clean;
  return details;
};

export const toDrillRow = (drill: Drill): DrillRow => ({
  id: drill.id,
  name: drill.name,
  focus: drill.focus,
  details: drillDetails(drill.minutes, drill.notes),
});

/** The queued payload. created_by is server-owned and set by the database, so it is not sent. */
export const drillPayload = (drill: Drill, teamId: string): Record<string, unknown> => ({
  team_id: teamId,
  name: drill.name,
  focus: drill.focus,
  details: drillDetails(drill.minutes, drill.notes),
});

export const emptyDrillDraft = (): DrillDraft => ({
  id: null,
  name: '',
  focus: '',
  minutes: DEFAULT_DRILL_MINUTES,
  notes: '',
});

export const draftFromDrill = (drill: Drill): DrillDraft => ({
  id: drill.id,
  name: drill.name,
  focus: drill.focus ?? '',
  minutes: drill.minutes,
  notes: drill.notes ?? '',
});

/** Returns the sentence to show the coach, or null when the draft can be queued. */
export function validateDrillDraft(draft: DrillDraft): string | null {
  const name = draft.name.trim();
  if (!name) return 'Give the drill a name, so the coach on the pitch knows what to run.';
  if (name.length > DRILL_NAME_MAX) return `Keep the drill name to ${DRILL_NAME_MAX} characters.`;
  if (draft.focus.trim().length > DRILL_FOCUS_MAX) return `Keep the focus to ${DRILL_FOCUS_MAX} characters.`;
  if (draft.notes.trim().length > DRILL_NOTES_MAX) return `Keep the notes to ${DRILL_NOTES_MAX} characters.`;
  if (
    !Number.isInteger(draft.minutes) ||
    draft.minutes < DRILL_MINUTES_MIN ||
    draft.minutes > DRILL_MINUTES_MAX
  ) {
    return `Set the timer between ${DRILL_MINUTES_MIN} and ${DRILL_MINUTES_MAX} whole minutes.`;
  }
  return null;
}

export function drillFromDraft(draft: DrillDraft, id: string): Drill {
  return {
    id,
    name: draft.name.trim().slice(0, DRILL_NAME_MAX),
    focus: trimOrNull(draft.focus),
    minutes: clampMinutes(draft.minutes),
    notes: trimOrNull(draft.notes),
  };
}

export const summarizeDrill = (drill: Drill): string =>
  [drill.focus, `${drill.minutes} min`].filter(Boolean).join(' - ');

// --- timer ---------------------------------------------------------------------------------

export const drillSeconds = (minutes: number): number => clampMinutes(minutes) * 60;

/**
 * Countdown from an absolute deadline rather than decrementing state, so a phone that throttles
 * timers in the background still shows the right clock when the coach looks back at it.
 */
export const remainingFromDeadline = (deadlineMs: number, nowMs: number): number =>
  Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));

export const extendRemaining = (remaining: number, seconds: number): number =>
  Math.min(drillSeconds(DRILL_MINUTES_MAX), Math.max(0, remaining + seconds));

export function formatClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** 0 to 1, for the progress bar. A zero-length drill reads as full rather than invisible. */
export const timerProgress = (remaining: number, total: number): number =>
  total <= 0 ? 1 : Math.min(1, Math.max(0, 1 - remaining / total));
