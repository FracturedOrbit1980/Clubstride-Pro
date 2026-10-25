// Every rule in this file mirrors a policy in
// clubstride-pro/supabase/migrations/20261023120000_clubstride_pro_baseline.sql. A payload that
// breaks one is rejected at flush time, which is hours after the coach left the pitch with no
// signal - so the contract is checked on the phone, before the row is ever queued.

export type SyncTable =
  | 'matches'
  | 'match_players'
  | 'match_events'
  | 'players'
  | 'drills'
  | 'progression_feedback'
  | 'attendance'
  | 'team_settings';

export type OutboxOp = 'upsert' | 'tombstone' | 'delete';

export type PeriodLabel = '1st Half' | '2nd Half';

export interface TableContract {
  /**
   * INSERT policies pin this column to auth.uid(), so only the account that recorded the row
   * can push it. That is why the outbox is namespaced per user and refuses to queue while the
   * session is unknown.
   */
  insertOwner: 'created_by' | 'coach_id' | null;
  /**
   * False only for match_players, which has no deleted_at column. Everything else is un-listed
   * by UPDATE rather than DELETE: matches_staff_delete and attendance_staff_delete are
   * manager-only, so a coach's delete has to travel as a tombstone or it dies on RLS.
   */
  tombstoned: boolean;
  /**
   * Client-supplied version for last-write-wins. updated_at cannot be used because the
   * *_touch triggers overwrite it with NOW() on every write, including a replay.
   */
  versionColumn: 'recorded_at' | null;
  /** Lowest rank flushes first: a match row has to exist before its lineup and its events. */
  flushRank: number;
}

export const TABLE_CONTRACTS: Record<SyncTable, TableContract> = {
  matches: { insertOwner: 'created_by', tombstoned: true, versionColumn: 'recorded_at', flushRank: 0 },
  players: { insertOwner: null, tombstoned: true, versionColumn: null, flushRank: 0 },
  drills: { insertOwner: null, tombstoned: true, versionColumn: null, flushRank: 0 },
  match_players: { insertOwner: null, tombstoned: false, versionColumn: null, flushRank: 1 },
  match_events: { insertOwner: 'created_by', tombstoned: true, versionColumn: 'recorded_at', flushRank: 1 },
  progression_feedback: { insertOwner: 'coach_id', tombstoned: true, versionColumn: 'recorded_at', flushRank: 1 },
  attendance: { insertOwner: null, tombstoned: true, versionColumn: 'recorded_at', flushRank: 1 },
  // One row per team, whose id *is* the team id: a queued settings edit is just an upsert
  // on `teams.id`, so it needs no row-id lookup table on the phone. No delete path.
  team_settings: { insertOwner: null, tombstoned: false, versionColumn: 'recorded_at', flushRank: 0 },
};

// Writing one of these on an upsert either overwrites a server-owned value (created_by
// re-claims ownership of another coach's row) or trips players_staff_write's
// `deleted_at IS NULL` check, which is evaluated on the insert half of ON CONFLICT.
const SERVER_OWNED_COLUMNS: ReadonlySet<string> = new Set([
  'id',
  'created_at',
  'updated_at',
  'deleted_at',
  'created_by',
  'coach_id',
  'recorded_by',
]);

/** Throws rather than queueing a row that Postgres will reject later. */
export function assertQueuedPayload(table: SyncTable, payload: Record<string, unknown>): void {
  const owned = Object.keys(payload).filter(key => SERVER_OWNED_COLUMNS.has(key));
  if (owned.length > 0) {
    throw new Error(`${table}: payload carries server-owned column(s) ${owned.join(', ')}`);
  }
  if (payload.recorded_at === undefined && TABLE_CONTRACTS[table].versionColumn) {
    throw new Error(`${table}: payload must carry recorded_at, it is the last-write-wins version`);
  }
}

/**
 * Postgres SQLSTATEs that will fail identically on every retry, so the entry is parked for a
 * human instead of burning battery until the phone dies. foreign_key_violation is deliberately
 * absent: 23503 usually just means the parent row is still behind it in the queue.
 */
const PERMANENT_CODES: ReadonlySet<string> = new Set([
  '42501', // insufficient_privilege - an RLS policy refused the write
  '23514', // check_violation
  '23505', // unique_violation - another device already wrote a different row for this key
  '42703', // undefined_column - the client is ahead of the applied migration
  '22P02', // invalid_text_representation - a value does not fit its column type
  'PGRST204', // PostgREST: column not found in schema cache
]);

/** The parts of PostgrestError this file reasons about, so callers can pass a plain object too. */
export interface PostgrestLike {
  code: string;
  message: string;
}

export function isPermanentFailure(error: PostgrestLike): boolean {
  return PERMANENT_CODES.has(error.code);
}

/**
 * postgrest-js leaves `code` empty for anything that never reached Postgres - the request died
 * in fetch. That is the "no signal" case, and it should stop the whole pass rather than retry
 * forty rows one by one against a dead connection.
 */
export function isNetworkFailure(error: PostgrestLike): boolean {
  return error.code === '';
}

export function describeError(error: PostgrestLike): string {
  const code = error.code ? ` (${error.code})` : '';
  return `${error.message}${code}`;
}

/**
 * Row ids are minted on the phone so an offline match can be replayed with its identity intact -
 * the server's gen_random_uuid() default cannot be used before reconnecting, and a local id like
 * Lite's `ev_1730000000` is not a UUID.
 */
export function mintRowId(): string {
  const webcrypto = globalThis.crypto;
  if (!webcrypto || typeof webcrypto.getRandomValues !== 'function') {
    // Surfaced instead of falling back to Math.random(): a weak uuid is fine, a duplicate that
    // silently merges two children's match records is not.
    throw new Error('crypto.getRandomValues is unavailable - import react-native-get-random-values before supabaseClient');
  }
  const bytes = Array.from(webcrypto.getRandomValues(new Uint8Array(16)));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map(value => value.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
