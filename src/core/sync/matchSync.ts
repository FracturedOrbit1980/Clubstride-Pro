import { mintRowId, type PeriodLabel } from './contracts';
import type { OutboxInput } from './outbox';
import type { SyncQueue } from './syncQueue';

export type MatchStatus = 'scheduled' | 'in_progress' | 'paused' | 'completed';

/** Anything the sync layer needs beyond the column names. */
export interface DraftMeta {
  /** The client-minted primary key. Mint it once and keep it; the id is how a replay is recognised. */
  rowId: string;
  /** Phone timestamp of this change. Also the last-write-wins version, so do not backfill it. */
  recordedAt: string;
}

export interface MatchDraft extends DraftMeta {
  teamId: string;
  title: string;
  opponentName: string;
  /** YYYY-MM-DD */
  matchDate: string;
  teamFormat: 5 | 7 | 9 | 11;
  formation: string;
  status: MatchStatus;
  periodLabel: PeriodLabel;
  durationSeconds: number;
  teamGoals: number;
  opponentGoals: number;
  endedAt: string | null;
}

export interface LineupEntry {
  /**
   * Minted once per (match, player) with `mintRowId()` and reused for every later edit of that
   * lineup row - match_players.id is a UUID, so a composed key like `match:player` is refused by
   * Postgres at flush time.
   */
  rowId: string;
  playerId: string;
  listedAs: 'starter' | 'bench';
  /** Playing minutes derived from the clock and the substitution log, already totalled. */
  recordedSeconds: number | null;
}

export type MatchEventDraft =
  | {
      kind: 'goal';
      matchId: string;
      scorerPlayerId: string;
      assisterPlayerId: string | null;
      periodLabel: PeriodLabel;
      matchTimeSeconds: number;
      recordedAt: string;
    }
  | {
      kind: 'substitution';
      matchId: string;
      /** The player coming on, because `actor_player_id` is NOT NULL and the sub-in is the actor. */
      inPlayerId: string;
      /** Required: match_events checks that a substitution always names both players. */
      outPlayerId: string;
      periodLabel: PeriodLabel;
      matchTimeSeconds: number;
      recordedAt: string;
    }
  | {
      kind: 'card_yellow' | 'card_red';
      matchId: string;
      playerId: string;
      periodLabel: PeriodLabel;
      matchTimeSeconds: number;
      recordedAt: string;
    };

export const nowIso = (): string => new Date().toISOString();

/**
 * Returns the row ids that belong to this event so undo can tombstone all of them - a goal is
 * two rows, because the assist points back at the goal through link_event_id.
 *
 * An empty array means nothing was queued, which only happens while no session is attached.
 */
export function queueMatch(queue: SyncQueue, draft: MatchDraft): boolean {
  const input: OutboxInput = {
    table: 'matches',
    rowId: draft.rowId,
    op: 'upsert',
    requiresRowId: null,
    recordedAt: draft.recordedAt,
    payload: {
      team_id: draft.teamId,
      title: draft.title,
      opponent_name: draft.opponentName,
      match_date: draft.matchDate,
      team_format: draft.teamFormat,
      formation: draft.formation,
      status: draft.status,
      period_label: draft.periodLabel,
      duration_seconds: draft.durationSeconds,
      team_goals: draft.teamGoals,
      opponent_goals: draft.opponentGoals,
      ended_at: draft.endedAt,
      recorded_at: draft.recordedAt,
    },
  };
  return queue.enqueue(input);
}

export function queueLineup(queue: SyncQueue, matchId: string, entries: readonly LineupEntry[], recordedAt: string): boolean {
  if (entries.length === 0) return true;
  let queued = true;
  for (const entry of entries) {
    const lineupQueued = queue.enqueue({
      table: 'match_players',
      rowId: entry.rowId,
      op: 'upsert',
      requiresRowId: matchId,
      recordedAt,
      payload: {
        match_id: matchId,
        player_id: entry.playerId,
        listed_as: entry.listedAs,
        recorded_seconds: entry.recordedSeconds,
      },
    });
    queued = queued && lineupQueued;
  }
  return queued;
}

export function queueEvent(queue: SyncQueue, draft: MatchEventDraft): string[] {
  const rowIds: string[] = [];

  const shared = {
    table: 'match_events' as const,
    op: 'upsert' as const,
    requiresRowId: draft.matchId,
    recordedAt: draft.recordedAt,
  };

  if (draft.kind === 'goal') {
    const goalRowId = mintRowId();
    const goalQueued = queue.enqueue({
      ...shared,
      rowId: goalRowId,
      payload: {
        match_id: draft.matchId,
        kind: 'goal',
        actor_player_id: draft.scorerPlayerId,
        period_label: draft.periodLabel,
        match_time_seconds: draft.matchTimeSeconds,
        recorded_at: draft.recordedAt,
      },
    });
    if (!goalQueued) return [];
    rowIds.push(goalRowId);

    if (draft.assisterPlayerId) {
      const assistRowId = mintRowId();
      const assistQueued = queue.enqueue({
        ...shared,
        rowId: assistRowId,
        // Gated on the goal row rather than on the match: the goal is itself gated on the match,
        // so an assist can never overtake the link_event_id foreign key it depends on.
        requiresRowId: goalRowId,
        payload: {
          match_id: draft.matchId,
          kind: 'assist',
          actor_player_id: draft.assisterPlayerId,
          link_event_id: goalRowId,
          period_label: draft.periodLabel,
          match_time_seconds: draft.matchTimeSeconds,
          recorded_at: draft.recordedAt,
        },
      });
      if (assistQueued) rowIds.push(assistRowId);
    }
    return rowIds;
  }

  if (draft.kind === 'substitution') {
    const rowId = mintRowId();
    const queued = queue.enqueue({
      ...shared,
      rowId,
      payload: {
        match_id: draft.matchId,
        kind: 'substitution',
        actor_player_id: draft.inPlayerId,
        second_player_id: draft.outPlayerId,
        period_label: draft.periodLabel,
        match_time_seconds: draft.matchTimeSeconds,
        recorded_at: draft.recordedAt,
      },
    });
    return queued ? [rowId] : [];
  }

  const rowId = mintRowId();
  const queued = queue.enqueue({
    ...shared,
    rowId,
    payload: {
      match_id: draft.matchId,
      kind: draft.kind,
      actor_player_id: draft.playerId,
      period_label: draft.periodLabel,
      match_time_seconds: draft.matchTimeSeconds,
      recorded_at: draft.recordedAt,
    },
  });
  return queued ? [rowId] : [];
}

/**
 * One tombstone per row id. Queued rather than sent straight away because the delete happens on
 * the same phone that recorded it, and the app's undo is expected to survive a restart.
 */
export function queueEventUndo(queue: SyncQueue, rowIds: readonly string[], recordedAt = nowIso()): number {
  let tombstoned = 0;
  for (const rowId of rowIds) {
    if (queue.enqueue({ table: 'match_events', rowId, op: 'tombstone', payload: {}, requiresRowId: null, recordedAt })) {
      tombstoned += 1;
    }
  }
  return tombstoned;
}
