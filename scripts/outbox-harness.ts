// Behavioural checks for the offline outbox, driven by a fake PostgREST client.
// Run: node scripts/run-harness.mjs
import { SyncQueue } from '../src/core/sync/syncQueue';
import { coalesce, sortForFlush, type OutboxInput } from '../src/core/sync/outbox';
import { mintRowId } from '../src/core/sync/contracts';
import { nowIso, queueEvent, queueEventUndo, queueLineup, queueMatch } from '../src/core/sync/matchSync';

interface Call {
  table: string;
  method: 'select' | 'update' | 'upsert' | 'delete';
  rowId: string | null;
  payload: Record<string, unknown> | null;
}

interface ApiError {
  code: string;
  message: string;
}

type Plan = (call: Call) => { data: unknown; error: ApiError | null };

async function main(): Promise<void> {
  const log: Call[] = [];

  function fakeClient(plan: Plan): unknown {
    class Q {
      rowId: string | null = null;
      payload: Record<string, unknown> | null = null;
      method: 'select' | 'update' | 'upsert' | 'delete' = 'select';
      tableName: string;

      constructor(table: string) {
        this.tableName = table;
      }
      select(): Q {
        this.method = 'select';
        return this;
      }
      update(payload: Record<string, unknown>): Q {
        this.method = 'update';
        this.payload = payload;
        return this;
      }
      upsert(payload: Record<string, unknown>): Q {
        this.method = 'upsert';
        this.payload = payload;
        return this;
      }
      delete(): Q {
        this.method = 'delete';
        return this;
      }
      eq(_column: string, value: string): Q {
        this.rowId = value;
        return this;
      }
      maybeSingle(): Q {
        return this;
      }
      then<R>(onFulfilled: (value: { data: unknown; error: ApiError | null }) => R): Promise<R> {
        const idFromPayload = this.payload ? (this.payload.id as string | undefined) : undefined;
        const call: Call = {
          table: this.tableName,
          method: this.method,
          rowId: this.rowId ?? idFromPayload ?? null,
          payload: this.payload,
        };
        log.push(call);
        return Promise.resolve(plan(call)).then(onFulfilled);
      }
    }
    return { from: (table: string) => new Q(table) };
  }

  const ok: { data: unknown; error: ApiError | null } = { data: null, error: null };
  const assert = (label: string, condition: boolean, extra?: unknown): void => {
    if (condition) {
      console.log(`ok   ${label}`);
    } else {
      console.error(`FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
      process.exitCode = 1;
    }
  };
  const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
  // Enqueue kicks off its own pass, so give that a chance to run before asserting.
  const settle = async (q: SyncQueue): Promise<void> => {
    await wait(30);
    await q.drain();
    await wait(30);
  };

  // --- 1. queue rules, no network involved ---------------------------------------------

  const base: OutboxInput = {
    table: 'matches',
    rowId: 'm1',
    op: 'upsert',
    payload: { team_id: 't1', opponent_name: 'Rovers', recorded_at: '2026-10-23T10:00:00.000Z' },
    requiresRowId: null,
    recordedAt: '2026-10-23T10:00:00.000Z',
  };
  let state = { nextSeq: 1, entries: [] as ReturnType<typeof coalesce>['entries'] };
  state = coalesce(state, base);
  state = coalesce(state, { ...base, recordedAt: '2026-10-23T10:05:00.000Z', payload: { ...base.payload, team_goals: 2, recorded_at: '2026-10-23T10:05:00.000Z' } });
  state = coalesce(state, { ...base, op: 'tombstone', payload: {}, recordedAt: '2026-10-23T10:09:00.000Z' });

  assert('three edits of one row stay one entry', state.entries.length === 1, state.entries);
  assert('the delete wins and its payload is dropped', state.entries[0]?.op === 'tombstone' && Object.keys(state.entries[0]?.payload ?? {}).length === 0);
  assert('the newest phone timestamp is what becomes deleted_at', state.entries[0]?.recordedAt === '2026-10-23T10:09:00.000Z');

  const firstTouchSeq = state.entries[0]?.seq ?? 0;
  state = coalesce(state, { ...base, rowId: 'e1', table: 'match_events', op: 'upsert', requiresRowId: 'm1', payload: { match_id: 'm1', kind: 'goal', recorded_at: 'x' }, recordedAt: '2026-10-23T10:10:00.000Z' });
  state = coalesce(state, { ...base, payload: { team_id: 't1', recorded_at: 'y' }, recordedAt: '2026-10-23T10:11:00.000Z' });
  assert('a re-edit after a tombstone keeps the first-touch seq', state.entries.find(entry => entry.rowId === 'm1')?.seq === firstTouchSeq);
  assert('the match flushes ahead of its event', sortForFlush(state.entries)[0]?.rowId === 'm1', sortForFlush(state.entries).map(entry => entry.rowId));

  let rejection = '';
  try {
    coalesce(state, { ...base, rowId: 'm9', payload: { team_id: 't1', created_by: 'u1', deleted_at: null } });
  } catch (error) {
    rejection = String(error);
  }
  assert('server-owned columns are refused at enqueue, not at flush', rejection.includes('server-owned'), rejection);
  assert('minted ids are version-4 uuids', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(mintRowId()));

  // --- 2. a match recorded with no signal, drained on reconnect -------------------------

  const server: Record<string, string> = {};
  const reached: string[] = [];

  const plan: Plan = call => {
    if (call.method === 'select') {
      const stamped = server[`${call.table}:${call.rowId}`];
      return { data: stamped ? { recorded_at: stamped } : null, error: null };
    }
    const kind = (call.payload as { kind?: string } | null)?.kind;
    if (call.table === 'match_events' && kind === 'assist') {
      const link = (call.payload as { link_event_id?: string }).link_event_id ?? '';
      if (!reached.includes(`inserted:${link}`)) return { data: null, error: { code: '23503', message: 'foreign key link_event_id' } };
    }
    if (call.method === 'upsert' && call.payload) {
      reached.push(`inserted:${call.rowId}`);
      server[`${call.table}:${call.rowId}`] = String(call.payload.recorded_at ?? '');
    }
    return ok;
  };

  const queue = new SyncQueue(fakeClient(plan) as never);
  queue.attach('coach-1');
  await wait(25);

  queueMatch(queue, {
    rowId: 'match-1',
    recordedAt: '2026-10-23T11:00:00.000Z',
    teamId: 'team-1',
    title: 'Match 2',
    opponentName: 'Rovers',
    matchDate: '2026-10-23',
    teamFormat: 7,
    formation: '2-3-1',
    status: 'completed',
    periodLabel: '2nd Half',
    durationSeconds: 3120,
    teamGoals: 1,
    opponentGoals: 0,
    endedAt: '2026-10-23T11:52:00.000Z',
  });

  // queued in the order a coach would tap: the assist first, because the picker was faster
  const assistDraft = {
    kind: 'goal' as const,
    matchId: 'match-1',
    scorerPlayerId: 'player-1',
    assisterPlayerId: 'player-2',
    periodLabel: '1st Half' as const,
    matchTimeSeconds: 1830,
    recordedAt: '2026-10-23T11:02:00.000Z',
  };
  const goalRows = queueEvent(queue, assistDraft);
  assert('a goal queues the goal row and its assist', goalRows.length === 2, goalRows);

  queueEvent(queue, {
    kind: 'substitution',
    matchId: 'match-1',
    inPlayerId: 'player-3',
    outPlayerId: 'player-1',
    periodLabel: '2nd Half',
    matchTimeSeconds: 2700,
    recordedAt: '2026-10-23T11:03:00.000Z',
  });

  await settle(queue);

  const writes = log.filter(call => call.method !== 'select');
  const eventWrites = writes.filter(call => call.table === 'match_events');
  assert('everything flushed', queue.getSnapshot().pending === 0, queue.getSnapshot());
  assert('the match row went in before its events', writes[0]?.table === 'matches' && writes[0]?.rowId === 'match-1', writes.map(call => `${call.table}:${call.rowId}`));
  assert('the assist arrived after the goal it links to', eventWrites[0]?.payload?.kind === 'goal' && eventWrites[1]?.payload?.kind === 'assist', eventWrites.map(call => call.payload?.kind));
  assert('created_by is pinned to the recording account', writes[0]?.payload?.created_by === 'coach-1', writes[0]?.payload);
  assert('the offline score reaches the server untouched', writes[0]?.payload?.team_goals === 1 && writes[0]?.payload?.duration_seconds === 3120);
  assert('recorded_at travels as the phone timestamp, not the reconnect time', writes[0]?.payload?.recorded_at === '2026-10-23T11:00:00.000Z');

  // --- 2b. the lineup rides along with the match ------------------------------------------

  const starterRowId = mintRowId();
  queueLineup(queue, 'match-1', [{ rowId: starterRowId, playerId: 'player-1', listedAs: 'starter', recordedSeconds: 1800 }], '2026-10-23T11:40:00.000Z');
  await settle(queue);
  const firstLineup = log.find(call => call.table === 'match_players' && call.method === 'upsert');
  assert('a lineup row id is a real uuid, not a composed key', firstLineup?.rowId === starterRowId, firstLineup?.rowId);
  assert('lineup rows carry no created_by', !('created_by' in (firstLineup?.payload ?? {})), firstLineup?.payload);

  queueLineup(queue, 'match-1', [{ rowId: starterRowId, playerId: 'player-1', listedAs: 'bench', recordedSeconds: 2400 }], '2026-10-23T11:50:00.000Z');
  await settle(queue);
  const lineupWrites = log.filter(call => call.table === 'match_players' && call.method === 'upsert');
  assert('a re-listed starter updates one row rather than queuing two', lineupWrites.length === 2, lineupWrites.map(call => call.payload?.recorded_seconds));
  assert('the latest minutes win', lineupWrites[1]?.payload?.recorded_seconds === 2400 && lineupWrites[1]?.payload?.listed_as === 'bench');

  // --- 3. two devices, one match ---------------------------------------------------------

  server['matches:match-9'] = '2026-10-23T14:00:00.000Z';
  queueMatch(queue, {
    rowId: 'match-9',
    recordedAt: '2026-10-23T09:00:00.000Z',
    teamId: 'team-1',
    title: 'Match 3',
    opponentName: 'Older copy',
    matchDate: '2026-10-23',
    teamFormat: 7,
    formation: '2-3-1',
    status: 'scheduled',
    periodLabel: '1st Half',
    durationSeconds: 0,
    teamGoals: 0,
    opponentGoals: 0,
    endedAt: null,
  });
  await settle(queue);
  assert('the club copy wins when the phone copy is older', queue.getSnapshot().superseded === 1, queue.getSnapshot());
  assert('nothing was written for the superseded row', !log.some(call => call.rowId === 'match-9' && call.method !== 'select'));

  server['matches:match-8'] = '2026-10-23T08:00:00.000Z';
  queueMatch(queue, {
    rowId: 'match-8',
    recordedAt: '2026-10-23T12:00:00.000Z',
    teamId: 'team-1',
    title: 'Match 4',
    opponentName: 'Rovers',
    matchDate: '2026-10-23',
    teamFormat: 7,
    formation: '2-3-1',
    status: 'in_progress',
    periodLabel: '2nd Half',
    durationSeconds: 100,
    teamGoals: 0,
    opponentGoals: 0,
    endedAt: null,
  });
  await settle(queue);
  const takeover = log.find(call => call.rowId === 'match-8' && call.method === 'upsert');
  assert('updating a row another coach created does not steal its created_by', takeover && !('created_by' in (takeover.payload ?? {})), takeover?.payload);

  // --- 4. undo travels as a tombstone -----------------------------------------------------

  const undone = queueEventUndo(queue, goalRows, nowIso());
  await settle(queue);
  const tombstones = log.filter(call => call.method === 'update');
  assert('undo of a goal tombstones both rows', undone === 2 && tombstones.length >= 2, tombstones.map(call => call.rowId));
  assert('a tombstone is an UPDATE carrying deleted_at', tombstones.every(call => typeof call.payload?.deleted_at === 'string'));
  assert('match rows are never hard-deleted', !log.some(call => call.table === 'matches' && call.method === 'delete'));
  assert('match_events rows are never hard-deleted', !log.some(call => call.table === 'match_events' && call.method === 'delete'));

  // --- 5. failure modes are parked, not retried into oblivion ------------------------------

  const refused = new SyncQueue(
    fakeClient(call => (call.method === 'select' ? ok : { data: null, error: { code: '42501', message: 'row-level security' } })) as never,
  );
  refused.attach('coach-2');
  await wait(25);
  refused.enqueue({ table: 'matches', rowId: 'match-x', op: 'upsert', requiresRowId: null, recordedAt: nowIso(), payload: { team_id: 't1', recorded_at: nowIso() } });
  await settle(refused);
  assert('an RLS refusal is parked for a human', refused.getSnapshot().blocked === 1, refused.getSnapshot());
  assert('the parked row says which policy failed', (refused.getSnapshot().lastFlushError ?? '').includes('42501'));
  const parkedWrites = refused.getSnapshot();
  assert('a parked row is not counted as pending work', parkedWrites.pending === 0 && parkedWrites.blocked === 1);

  let attempts = 0;
  const offline = new SyncQueue(
    fakeClient(() => {
      attempts += 1;
      return { data: null, error: { code: '', message: 'TypeError: Network request failed' } };
    }) as never,
  );
  offline.attach('coach-3');
  await wait(25);
  offline.enqueue({ table: 'matches', rowId: 'm-a', op: 'upsert', requiresRowId: null, recordedAt: nowIso(), payload: { team_id: 't1', recorded_at: nowIso() } });
  offline.enqueue({ table: 'matches', rowId: 'm-b', op: 'upsert', requiresRowId: null, recordedAt: nowIso(), payload: { team_id: 't1', recorded_at: nowIso() } });
  // One pass per queue: a second pass would park the back-off row and hide it from pending.
  await wait(30);
  assert('no signal stops the pass after the first row instead of hammering', attempts === 1, attempts);
  assert('nothing is lost while offline', offline.getSnapshot().pending === 2, offline.getSnapshot());
  assert('the queue says when it is not connected', offline.getSnapshot().attached === true);

  // --- 6. the queue survives an app kill ----------------------------------------------------

  // Still no signal on restart, so the recovered rows must stay queued.
  const revived = new SyncQueue(
    fakeClient(() => ({ data: null, error: { code: '', message: 'TypeError: Network request failed' } })) as never,
  );
  revived.attach('coach-3');
  await wait(25);
  assert('the two unsent rows come back after a restart', revived.getSnapshot().pending === 2, revived.getSnapshot());

  const other = new SyncQueue(fakeClient(plan) as never);
  other.attach('coach-4');
  await wait(25);
  assert('another account on the same phone sees an empty queue', other.getSnapshot().pending === 0, other.getSnapshot());

  // --- 7. deleting the account takes the local copy with it -------------------------------

  const noSignal = () => ({ data: null, error: { code: '', message: 'TypeError: Network request failed' } });
  const leaving = new SyncQueue(fakeClient(noSignal) as never);
  leaving.attach('coach-5');
  await wait(25);
  leaving.enqueue({ table: 'matches', rowId: 'm-gone', op: 'upsert', requiresRowId: null, recordedAt: nowIso(), payload: { team_id: 't1', recorded_at: nowIso() } });
  await wait(30);

  const survivor = new SyncQueue(fakeClient(noSignal) as never);
  survivor.attach('coach-6');
  await wait(25);
  survivor.enqueue({ table: 'matches', rowId: 'm-stay', op: 'upsert', requiresRowId: null, recordedAt: nowIso(), payload: { team_id: 't1', recorded_at: nowIso() } });
  await wait(30);

  await leaving.clearLocal();
  assert('clearing detaches the queue', leaving.getSnapshot().pending === 0 && leaving.getSnapshot().attached === false, leaving.getSnapshot());
  assert('another signed-in account keeps its unsent rows', survivor.getSnapshot().pending === 1, survivor.getSnapshot());

  // The account is gone, but a reinstall on the same phone would re-read this key if the blob
  // had survived - and the rows could never flush.
  const reinstalled = new SyncQueue(fakeClient(noSignal) as never);
  reinstalled.attach('coach-5');
  await wait(25);
  assert('the deleted account queue is gone from storage', reinstalled.getSnapshot().pending === 0, reinstalled.getSnapshot());
  assert('the other account blob was not taken by mistake', survivor.getSnapshot().pending === 1);

  queue.dispose();
  refused.dispose();
  offline.dispose();
  revived.dispose();
  other.dispose();
  leaving.dispose();
  survivor.dispose();
  reinstalled.dispose();
  console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nall outbox checks passed');
}

void main();
