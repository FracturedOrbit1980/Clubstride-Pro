import type { SupabaseClient } from '@supabase/supabase-js';
import {
  describeError,
  isNetworkFailure,
  isPermanentFailure,
  TABLE_CONTRACTS,
  type PostgrestLike,
} from './contracts';
import {
  coalesce,
  loadOutbox,
  outboxStorageKey,
  removeOutbox,
  saveOutbox,
  sortForFlush,
  type OutboxEntry,
  type OutboxInput,
  type OutboxState,
} from './outbox';

const BASE_RETRY_MS = 2_000;
const MAX_RETRY_MS = 300_000;
/** A server-side rejection that keeps failing this often is not a transient fault any more. */
const BLOCK_AFTER_ATTEMPTS = 12;

type FlushOutcome =
  | { kind: 'done' }
  | { kind: 'stale' }
  | { kind: 'retry'; error: PostgrestLike }
  | { kind: 'blocked'; error: PostgrestLike };

export interface SyncQueueSnapshot {
  /** False while no session is known, which means enqueue is a no-op that the UI must show. */
  attached: boolean;
  flushing: boolean;
  /**
   * Rows that may still reach the club. A row parked by back-off is counted as pending rather
   * than dropped, or a reconnect pass that trips one row would silently delete the rest.
   */
  pending: number;
  /** Rows refused for a reason a retry cannot fix; they need a human, so they stay visible. */
  blocked: number;
  /** Rows dropped because the server already held a newer `recorded_at`. */
  superseded: number;
  oldestRecordedAt: string | null;
  nextRetryAtMs: number | null;
  /** Queue-side trouble: storage did not take the write, so a phone restart would lose it. */
  warning: string | null;
  lastFlushError: string | null;
}

const retryDelay = (attempts: number): number => {
  const window = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.min(attempts - 1, 8));
  // Spread across devices so a squad of coaches reconnecting at kick-off does not sync in lockstep.
  return Math.round(window * (0.8 + Math.random() * 0.4));
};

const classify = (error: PostgrestLike): FlushOutcome =>
  isPermanentFailure(error) ? { kind: 'blocked', error } : { kind: 'retry', error };

const toErrorLike = (thrown: unknown): PostgrestLike => {
  if (thrown instanceof Error) return { code: '', message: thrown.message };
  return { code: '', message: String(thrown) };
};

/**
 * Serialises writes to Supabase for the signed-in account.
 *
 * Match day happens on a phone with no signal, so every write is queued locally first and
 * replayed later. The queue holds the *latest state per row*, keyed by table + row id, which is
 * what makes thirty edits of one match archive into one request and lets a delete win over the
 * edits that preceded it.
 */
export class SyncQueue {
  private readonly client: SupabaseClient;

  private userId: string | null = null;
  private key: string | null = null;
  private state: OutboxState | null = null;

  private flushing = false;
  private superseded = 0;
  private warning: string | null = null;
  private lastFlushError: string | null = null;

  private saveChain: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: SyncQueueSnapshot;

  constructor(client: SupabaseClient) {
    this.client = client;
    this.snapshot = this.buildSnapshot();
  }

  // --- React store contract -------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SyncQueueSnapshot => this.snapshot;

  // --- lifecycle ------------------------------------------------------------------------

  attach(userId: string | null): void {
    if (userId === this.userId) return;
    this.clearTimer();
    this.userId = userId;
    this.key = userId ? outboxStorageKey(userId) : null;
    this.flushing = false;
    this.superseded = 0;

    if (!userId || !this.key) {
      this.state = null;
      // Not swallowed: a coach recording while the session has not restored yet needs to see
      // that nothing was queued, because the row cannot be attributed to an account.
      this.warning = 'Not signed in, so changes are not queued for sync.';
      this.notify();
      return;
    }
    void this.hydrate(this.key, userId);
  }

  dispose(): void {
    this.clearTimer();
    this.listeners.clear();
  }

  /**
   * Forgets the account and deletes its stored queue. Call it only after
   * `delete_user_account()` has succeeded, and before signing out, while `this.key` still
   * names the account that has just ceased to exist.
   *
   * Detaching first is what makes this safe to call with a drain in flight: the pass breaks on
   * the changed user id, and persist() returns early once there is no key, so nothing can put
   * the dead account's rows back on disk after the removal.
   */
  async clearLocal(): Promise<void> {
    this.clearTimer();
    const key = this.key;
    this.userId = null;
    this.key = null;
    this.state = null;
    this.flushing = false;
    // Same reset attach(null) would do, which is bypassed here because the id is already null.
    this.superseded = 0;
    this.lastFlushError = null;
    this.notify();
    if (!key) return;

    await this.saveChain;
    try {
      await removeOutbox(key);
    } catch (error) {
      // The account is gone either way, so this is reported rather than retried: a stale queue
      // on a signed-out phone is a data-protection problem, not a sync problem.
      this.warning = `Could not clear the stored sync queue: ${String(error)}`;
      this.notify();
    }
  }

  private async hydrate(key: string, userId: string): Promise<void> {
    const { state, warning } = await loadOutbox(key);
    // The coach may have signed out before the read came back.
    if (this.userId !== userId || this.key !== key) return;
    this.state = state;
    this.warning = warning;
    this.notify();
    void this.drain();
  }

  // --- writing --------------------------------------------------------------------------

  /** Returns false when nothing was queued, which the calling screen must surface. */
  enqueue(input: OutboxInput): boolean {
    if (!this.state || !this.key) {
      this.warning = 'Not signed in, so this change was not queued for sync.';
      this.notify();
      return false;
    }
    this.state = coalesce(this.state, input);
    this.warning = null;
    this.persist(this.state);
    this.notify();
    void this.drain();
    return true;
  }

  /** Un-parks every blocked row and flushes - the retry half of the banner's Retry button. */
  retryBlocked(): void {
    if (!this.state) return;
    this.state = {
      ...this.state,
      entries: this.state.entries.map(entry => ({
        ...entry,
        blocked: false,
        attempts: 0,
        nextRetryAtMs: 0,
        lastError: null,
      })),
    };
    this.lastFlushError = null;
    this.persist(this.state);
    this.notify();
    void this.drain();
  }

  private persist(next: OutboxState): void {
    if (!this.key) return;
    const key = this.key;
    this.saveChain = this.saveChain
      .then(() => saveOutbox(key, next))
      .then(() => {
        if (this.warning?.startsWith('Sync queue is not saved')) {
          this.warning = null;
          this.notify();
        }
      })
      .catch(error => {
        // An un-persisted queue dies with the next app restart, which is the exact failure this
        // subsystem exists to prevent, so it is reported rather than logged and forgotten.
        this.warning = `Sync queue is not saved to the phone: ${String(error)}`;
        this.notify();
      });
  }

  // --- flushing -------------------------------------------------------------------------

  async drain(): Promise<void> {
    if (this.flushing) return;
    const state = this.state;
    const userId = this.userId;
    if (!state || !this.key || !userId) return;
    this.flushing = true;
    this.notify();

    const now = Date.now();
    const key = this.key;
    const order = sortForFlush(state.entries);
    const queuedRowIds = new Set(order.map(entry => entry.rowId));
    const settled = new Set<string>();
    const finished = new Set<OutboxEntry>();
    let networkDown = false;

    try {
      for (const entry of order) {
        if (networkDown || entry.blocked || entry.nextRetryAtMs > now) continue;
        // Sign-out mid-pass: stop before pushing the previous coach's rows under a new session.
        if (this.userId !== userId || this.key !== key) break;

        const dependency = entry.requiresRowId;
        // An event whose match is still in this same queue cannot be inserted yet; the FK would
        // fail and cost the entry a retry slot for no reason.
        if (dependency && queuedRowIds.has(dependency) && !settled.has(dependency)) continue;

        const outcome = await this.flushOne(entry, userId);
        switch (outcome.kind) {
          case 'done':
            settled.add(entry.rowId);
            finished.add(entry);
            break;
          case 'stale':
            settled.add(entry.rowId);
            finished.add(entry);
            this.superseded += 1;
            break;
          case 'blocked':
            entry.blocked = true;
            entry.lastError = describeError(outcome.error);
            this.lastFlushError = entry.lastError;
            break;
          case 'retry': {
            entry.attempts += 1;
            entry.lastError = describeError(outcome.error);
            this.lastFlushError = entry.lastError;
            if (isNetworkFailure(outcome.error)) {
              networkDown = true;
            } else if (entry.attempts >= BLOCK_AFTER_ATTEMPTS) {
              entry.blocked = true;
            }
            entry.nextRetryAtMs = Date.now() + retryDelay(entry.attempts);
            break;
          }
        }
      }
    } finally {
      // A coach keeps recording while a pass is in flight, so reconcile against the live state
      // rather than the snapshot taken at the start - the entries added mid-pass would otherwise
      // be dropped on the floor with the old array.
      const live = this.state;
      if (live && this.userId === userId && this.key === key) {
        const kept = live.entries.filter(entry => !finished.has(entry));
        if (kept.length === 0) this.lastFlushError = null;
        this.state = { nextSeq: live.nextSeq, entries: kept };
        this.persist(this.state);
      }
      this.flushing = false;
      this.notify();
      this.scheduleRetry();
    }
  }

  private async flushOne(entry: OutboxEntry, userId: string): Promise<FlushOutcome> {
    const contract = TABLE_CONTRACTS[entry.table];
    try {
      if (entry.op === 'delete') {
        const { error } = await this.client.from(entry.table).delete().eq('id', entry.rowId);
        return error ? classify(error) : { kind: 'done' };
      }

      if (entry.op === 'tombstone') {
        const { error } = await this.client
          .from(entry.table)
          .update({ deleted_at: entry.recordedAt })
          .eq('id', entry.rowId);
        // Zero rows matched means the row never reached the server, or RLS hides it from this
        // account. Both leave nothing to un-list, so the entry is finished either way.
        return error ? classify(error) : { kind: 'done' };
      }

      const versionColumn = contract.versionColumn;
      let existsOnServer = false;
      if (versionColumn) {
        const { data, error } = await this.client
          .from(entry.table)
          .select(versionColumn)
          .eq('id', entry.rowId)
          .maybeSingle();
        if (error) return classify(error);
        if (data) {
          existsOnServer = true;
          const serverVersion = (data as Record<string, unknown>)[versionColumn];
          // Last-write-wins is decided by the phone's `recorded_at`, never by who flushed last:
          // updated_at is overwritten by the *_touch triggers, so it says when the server heard
          // about the row, not when the coach made the change.
          if (Date.parse(String(serverVersion)) > Date.parse(entry.recordedAt)) return { kind: 'stale' };
        }
      }

      const row: Record<string, unknown> = { ...entry.payload, id: entry.rowId };
      // Only on the insert half: re-sending created_by over an existing row would move another
      // coach's match onto this account.
      if (contract.insertOwner && !existsOnServer) row[contract.insertOwner] = userId;

      const { error } = await this.client.from(entry.table).upsert(row, { onConflict: 'id' });
      return error ? classify(error) : { kind: 'done' };
    } catch (thrown) {
      return classify(toErrorLike(thrown));
    }
  }

  private scheduleRetry(): void {
    this.clearTimer();
    if (!this.state) return;
    const next = this.state.entries
      .filter(entry => !entry.blocked)
      .reduce<number | null>(
        (earliest, entry) => (entry.nextRetryAtMs > 0 ? Math.min(earliest ?? Infinity, entry.nextRetryAtMs) : earliest),
        null,
      );
    if (next === null || !Number.isFinite(next)) return;
    this.timer = setTimeout(() => {
      void this.drain();
    }, Math.max(250, next - Date.now()));
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private buildSnapshot(): SyncQueueSnapshot {
    const entries = this.state?.entries ?? [];
    const live = entries.filter(entry => !entry.blocked);
    const oldest = live.reduce<string | null>(
      (soonest, entry) => (soonest === null || entry.recordedAt < soonest ? entry.recordedAt : soonest),
      null,
    );
    const wait = live
      .map(entry => entry.nextRetryAtMs)
      .filter(attempt => attempt > 0)
      .reduce<number | null>((earliest, attempt) => Math.min(earliest ?? Infinity, attempt), null);

    return {
      attached: this.state !== null,
      flushing: this.flushing,
      pending: live.length,
      blocked: entries.length - live.length,
      superseded: this.superseded,
      oldestRecordedAt: oldest,
      nextRetryAtMs: wait === null || !Number.isFinite(wait) ? null : wait,
      warning: this.warning,
      lastFlushError: this.lastFlushError,
    };
  }

  private notify(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}
