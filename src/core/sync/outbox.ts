import AsyncStorage from '@react-native-async-storage/async-storage';
import { assertQueuedPayload, TABLE_CONTRACTS, type OutboxOp, type SyncTable } from './contracts';

/**
 * One pending server write. The queue is keyed by `table:rowId`, so a row edited thirty times
 * during a match stays one entry - the phone holds the latest state, not an operation log.
 */
export interface OutboxEntry {
  /** Queue-local sequence. Monotonic per account, and immune to a phone clock being wrong. */
  seq: number;
  table: SyncTable;
  /** Client-minted UUID, used as the server primary key. */
  rowId: string;
  op: OutboxOp;
  payload: Record<string, unknown>;
  /** When the coach made the change, on the phone. Doubles as the last-write-wins version. */
  recordedAt: string;
  /** Server row that must exist first: the parent match, or the goal an assist links to. */
  requiresRowId: string | null;
  attempts: number;
  nextRetryAtMs: number;
  blocked: boolean;
  lastError: string | null;
}

export interface OutboxInput {
  table: SyncTable;
  rowId: string;
  op: OutboxOp;
  payload: Record<string, unknown>;
  recordedAt: string;
  requiresRowId: string | null;
}

export interface OutboxState {
  nextSeq: number;
  entries: OutboxEntry[];
}

const EMPTY_STATE: OutboxState = { nextSeq: 1, entries: [] };

// Namespaced by account because matches/match_events pin `created_by = auth.uid()` on INSERT:
// a queue drained under the wrong session would be rejected row by row.
export const outboxStorageKey = (userId: string): string => `cs.outbox.v1.${userId}`;

const isSyncTable = (value: unknown): value is SyncTable =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(TABLE_CONTRACTS, value);

const isOutboxOp = (value: unknown): value is OutboxOp =>
  value === 'upsert' || value === 'tombstone' || value === 'delete';

const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);

function parseEntry(value: unknown): OutboxEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!isSyncTable(raw.table) || !isOutboxOp(raw.op) || typeof raw.rowId !== 'string') return null;
  const parent = raw as { payload?: unknown; requiresRowId?: unknown };
  return {
    seq: typeof raw.seq === 'number' ? raw.seq : 0,
    table: raw.table,
    rowId: raw.rowId,
    op: raw.op,
    payload: typeof parent.payload === 'object' && parent.payload !== null ? (parent.payload as Record<string, unknown>) : {},
    recordedAt: str(raw.recordedAt, new Date(0).toISOString()),
    requiresRowId: typeof parent.requiresRowId === 'string' ? parent.requiresRowId : null,
    attempts: typeof raw.attempts === 'number' ? raw.attempts : 0,
    nextRetryAtMs: typeof raw.nextRetryAtMs === 'number' ? raw.nextRetryAtMs : 0,
    blocked: raw.blocked === true,
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
  };
}

/**
 * A torn write (the app was killed mid-save) must not wedge syncing forever, and must not be
 * silently discarded either: the caller shows the warning next to the pending count.
 */
export async function loadOutbox(key: string): Promise<{ state: OutboxState; warning: string | null }> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch (error) {
    return { state: EMPTY_STATE, warning: `Could not read the sync queue: ${String(error)}` };
  }
  if (!raw) return { state: EMPTY_STATE, warning: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: EMPTY_STATE, warning: 'The stored sync queue was unreadable and has been reset.' };
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { entries?: unknown }).entries)) {
    return { state: EMPTY_STATE, warning: 'The stored sync queue was unreadable and has been reset.' };
  }

  const body = parsed as { nextSeq?: unknown; entries: unknown[] };
  const entries = body.entries.map(parseEntry).filter((entry): entry is OutboxEntry => entry !== null);
  const dropped = body.entries.length - entries.length;
  const maxSeq = entries.reduce((highest, entry) => Math.max(highest, entry.seq), 0);
  const nextSeq = Math.max(typeof body.nextSeq === 'number' ? body.nextSeq : 0, maxSeq + 1, 1);

  return {
    state: { nextSeq, entries },
    warning: dropped > 0 ? `${dropped} stored queue entry(s) were malformed and skipped.` : null,
  };
}

export function saveOutbox(key: string, state: OutboxState): Promise<void> {
  return AsyncStorage.setItem(key, JSON.stringify(state));
}

/**
 * There is no general "clear the queue" path, deliberately: the queue is the only copy of a
 * match recorded without signal. This is sound for exactly one caller - after
 * `delete_user_account()` has removed the account, so the rows can never flush and must not
 * stay on a phone that no longer has an owner. See `SyncQueue.clearLocal`.
 */
export function removeOutbox(key: string): Promise<void> {
  return AsyncStorage.removeItem(key);
}

/**
 * Merge an input into the state, keeping one entry per row.
 *
 * The surviving entry keeps the *first* touch's seq on purpose: a match created before its
 * events must still flush before them, even if its last edit landed after they were queued.
 * A row that was edited and then deleted collapses to the delete, and its payload is dropped -
 * tombstones travel as an UPDATE, and an upsert carrying `deleted_at` would hit the insert-side
 * `deleted_at IS NULL` check if the row never reached the server.
 */
export function coalesce(state: OutboxState, input: OutboxInput): OutboxState {
  if (input.op === 'upsert') assertQueuedPayload(input.table, input.payload);

  const existing = state.entries.find(entry => entry.table === input.table && entry.rowId === input.rowId);
  if (!existing) {
    const entry: OutboxEntry = {
      seq: state.nextSeq,
      table: input.table,
      rowId: input.rowId,
      op: input.op,
      payload: input.op === 'upsert' ? { ...input.payload } : {},
      recordedAt: input.recordedAt,
      requiresRowId: input.requiresRowId,
      attempts: 0,
      nextRetryAtMs: 0,
      blocked: false,
      lastError: null,
    };
    return { nextSeq: state.nextSeq + 1, entries: [...state.entries, entry] };
  }

  const merged: OutboxEntry = {
    ...existing,
    op: input.op,
    payload: input.op === 'upsert' ? { ...input.payload } : {},
    recordedAt: input.recordedAt,
    requiresRowId: input.requiresRowId ?? existing.requiresRowId,
    attempts: 0,
    nextRetryAtMs: 0,
    // A fresh edit is a fresh chance at a row that was parked earlier - it may be the fix.
    blocked: false,
    lastError: null,
  };
  return {
    nextSeq: state.nextSeq,
    entries: state.entries.map(entry => (entry === existing ? merged : entry)),
  };
}

/** Parents before children (flushRank), then the order the coach produced them (seq). */
export function sortForFlush(entries: readonly OutboxEntry[]): OutboxEntry[] {
  return [...entries].sort((a, b) => {
    const rank = TABLE_CONTRACTS[a.table].flushRank - TABLE_CONTRACTS[b.table].flushRank;
    return rank !== 0 ? rank : a.seq - b.seq;
  });
}
