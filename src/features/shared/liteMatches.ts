import type { PeriodLabel } from '../../core/sync/contracts';
import type { MatchStatus } from '../../core/sync/matchSync';
import type { OutboxInput } from '../../core/sync/outbox';
import { stableRowId } from '../../core/sync/stableId';
import { buildMatchLog, type PlayerMatchEntry } from '../coach/player/minutes';
import type { LiteRoster } from './liteRoster';

type MatchScope = Pick<LiteRoster, 'installationId' | 'teamId'>;
export interface LiteMatchPlayer {
  id: string;
  proId?: string;
  name: string;
  number: number;
  position: string;
}
export interface LiteMatchEvent {
  id: string;
  proId?: string;
  type: 'Goal' | 'Assist' | 'Sub' | 'Yellow' | 'Red';
  playerId?: string;
  playerInId?: string;
  playerOutId?: string;
  playerName?: string;
  playerNumber?: number;
  playerIn?: string;
  playerInNum?: number;
  playerOut?: string;
  playerOutNum?: number;
  goalId?: string;
  matchTimeSeconds: number;
  period: PeriodLabel;
  timestamp: string;
}
export interface LiteMatchRecord {
  id: string;
  proId?: string;
  title: string;
  teamName: string;
  opponent: string;
  date: string;
  format: '5' | '7' | '9' | '11';
  formation: string;
  ourGoals: number;
  opponentGoals: number;
  durationSeconds: number;
  period: PeriodLabel;
  status: MatchStatus;
  endedAt: string | null;
  recordedAt: string;
  playerTimers: Record<string, number>;
  starters: string[];
  bench: string[];
  players: LiteMatchPlayer[];
  lineupIds?: Record<string, string>;
  events: LiteMatchEvent[];
}
export interface LiteMatchRemoved {
  id: string;
  proId?: string;
  recordedAt: string;
}
export interface LiteMatches {
  version: 1;
  installationId: string;
  teamId: string;
  revision: string;
  matches: LiteMatchRecord[];
  live: LiteMatchRecord | null;
  removed: LiteMatchRemoved[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[a-z0-9_-]+$/i;
const MAX_INT = 2147483647;
const fail = (field: string): never => { throw new Error(`Invalid shared Lite matches: ${field}.`); };
const object = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return fail(field);
  return value as Record<string, unknown>;
};
const list = (value: unknown, field: string): unknown[] => Array.isArray(value) ? value : fail(field);
const id = (value: unknown): string => typeof value === 'string' && SAFE_ID.test(value) ? value : fail('identity');
const uuid = (value: unknown): string => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : fail('cloud UUID');
const optionalProId = (raw: Record<string, unknown>): { proId?: string } =>
  raw.proId === undefined ? {} : { proId: uuid(raw.proId) };
const text = (value: unknown, limit = 200, empty = false): string => {
  if (typeof value !== 'string' || value.length > limit || /[<>\u0000-\u001f\u007f-\u009f]/.test(value) || (!empty && !value.trim())) return fail('plain text');
  return value.trim();
};
const integer = (value: unknown, max = MAX_INT): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : fail('integer');
const date = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return fail('calendar date');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : fail('calendar date');
};
const iso = (value: unknown): string => {
  if (typeof value !== 'string') return fail('ISO timestamp');
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return fail('ISO timestamp');
  date(match[1]);
  const zone = match[6]!;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return fail('ISO timezone');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return fail('ISO timestamp');
  // Preserve sub-millisecond Postgres versions instead of truncating them through Date.
  return `${parsed.toISOString().slice(0, 19)}.${(match[5] ?? '').padEnd(3, '0')}Z`;
};
const version = (value: string): string => value.replace(/\.(\d+)Z$/, (_all, fraction: string) => `.${fraction.padEnd(9, '0')}Z`);
const compare = (a: string, b: string): number => version(a) < version(b) ? -1 : version(a) > version(b) ? 1 : 0;
const newest = (values: string[]): string => values.reduce((a, b) => compare(a, b) >= 0 ? a : b);
const period = (value: unknown): PeriodLabel => value === '1st Half' || value === '2nd Half' ? value : fail('period');
const status = (value: unknown): MatchStatus =>
  value === 'scheduled' || value === 'in_progress' || value === 'paused' || value === 'completed' ? value : fail('status');
const format = (value: unknown): LiteMatchRecord['format'] =>
  value === '5' || value === '7' || value === '9' || value === '11' ? value : fail('format');
const unique = (values: string[], field: string): string[] => new Set(values).size === values.length ? values : fail(`duplicate ${field}`);
const scope = (raw: Record<string, unknown>, expected: MatchScope): void => {
  if ((raw.installationId !== undefined && raw.installationId !== expected.installationId) ||
      (raw.teamId !== undefined && raw.teamId !== expected.teamId)) fail('foreign scope');
};

export const LITE_MATCHES_PREFIX = 'cs.lite.matches.v1.';

export const liteMatchesKey = (roster: MatchScope): string =>
  `${LITE_MATCHES_PREFIX}${id(roster.installationId)}.${id(roster.teamId)}`;

function parsePlayer(value: unknown, expected: MatchScope): LiteMatchPlayer {
  const raw = object(value, 'player');
  scope(raw, expected);
  return { id: id(raw.id), ...optionalProId(raw), name: text(raw.name), number: integer(raw.number, 99), position: text(raw.position, 40) };
}
function parseEvent(value: unknown, expected: MatchScope): LiteMatchEvent {
  const raw = object(value, 'event');
  scope(raw, expected);
  const type = raw.type;
  if (type !== 'Goal' && type !== 'Assist' && type !== 'Sub' && type !== 'Yellow' && type !== 'Red') return fail('event type');
  const result: LiteMatchEvent = { id: id(raw.id), ...optionalProId(raw), type,
    matchTimeSeconds: integer(raw.matchTimeSeconds), period: period(raw.period), timestamp: iso(raw.timestamp) };
  for (const key of ['playerId', 'playerInId', 'playerOutId', 'goalId'] as const) {
    if (raw[key] !== undefined) result[key] = id(raw[key]);
  }
  for (const key of ['playerName', 'playerIn', 'playerOut'] as const) {
    if (raw[key] !== undefined) {
      const name = text(raw[key], 200, true);
      if (name) result[key] = name;
    }
  }
  for (const key of ['playerNumber', 'playerInNum', 'playerOutNum'] as const) {
    if (raw[key] !== undefined) result[key] = integer(raw[key], 99);
  }
  return result;
}
function parseRecord(value: unknown, expected: MatchScope): LiteMatchRecord {
  const raw = object(value, 'match');
  scope(raw, expected);
  const players = list(raw.players, 'players').map(row => parsePlayer(row, expected));
  unique(players.map(row => row.id), 'player identity');
  unique(players.flatMap(row => row.proId ? [row.proId] : []), 'cloud player identity');
  const events = list(raw.events, 'events').map(row => parseEvent(row, expected));
  unique(events.map(row => row.id), 'event identity');
  unique(events.flatMap(row => row.proId ? [row.proId] : []), 'cloud event identity');
  const starters = unique(list(raw.starters, 'starters').map(id), 'starter');
  const bench = unique(list(raw.bench, 'bench').map(id), 'bench');
  unique([...starters, ...bench], 'lineup player');
  const playerTimers = Object.fromEntries(Object.entries(object(raw.playerTimers, 'timers')).map(([key, seconds]) => [id(key), integer(seconds)]));
  const lineupIds = raw.lineupIds === undefined ? undefined : Object.fromEntries(
    Object.entries(object(raw.lineupIds, 'lineup IDs')).map(([key, rowId]) => [id(key), uuid(rowId)]));
  if (lineupIds) unique(Object.values(lineupIds), 'lineup row identity');
  return { id: id(raw.id), ...optionalProId(raw), title: text(raw.title), teamName: text(raw.teamName), opponent: text(raw.opponent),
    date: date(raw.date), format: format(raw.format), formation: text(raw.formation, 40, true),
    ourGoals: integer(raw.ourGoals), opponentGoals: integer(raw.opponentGoals), durationSeconds: integer(raw.durationSeconds),
    period: period(raw.period), status: status(raw.status), endedAt: raw.endedAt === null ? null : iso(raw.endedAt), recordedAt: iso(raw.recordedAt),
    playerTimers, starters, bench, players, events, ...(lineupIds === undefined ? {} : { lineupIds }) };
}

/** All-or-nothing parsing; only explicitly constructed, non-auth fields survive. */
export function parseLiteMatches(value: unknown, roster: MatchScope): LiteMatches {
  liteMatchesKey(roster);
  const raw = object(value, 'snapshot');
  if (raw.version !== 1 || raw.installationId !== roster.installationId || raw.teamId !== roster.teamId) return fail('version or foreign scope');
  const matches = list(raw.matches, 'matches').map(row => parseRecord(row, roster));
  const live = raw.live === null ? null : parseRecord(raw.live, roster);
  const records = [...matches, ...(live ? [live] : [])];
  unique(records.map(row => row.id), 'match identity');
  unique(records.map(row => row.proId ?? row.id), 'canonical match identity');
  const removed = list(raw.removed, 'removed').map(value => {
    const row = object(value, 'removed match');
    scope(row, roster);
    return { id: id(row.id), ...optionalProId(row), recordedAt: iso(row.recordedAt) };
  });
  unique(removed.map(row => row.id), 'removed identity');
  unique(removed.map(row => row.proId ?? row.id), 'canonical removed identity');
  return { version: 1, installationId: roster.installationId, teamId: roster.teamId, revision: iso(raw.revision), matches, live, removed };
}
export function serializeLiteMatches(snapshot: LiteMatches, roster: MatchScope = snapshot): string {
  return JSON.stringify(parseLiteMatches(snapshot, roster));
}

const recordsOf = (snapshot: LiteMatches): LiteMatchRecord[] => [...snapshot.matches, ...(snapshot.live ? [snapshot.live] : [])];
const matchId = (roster: MatchScope, row: LiteMatchRemoved): string => row.proId ?? stableRowId('lite-match', roster.installationId, roster.teamId, row.id);
const eventId = (match: string, row: LiteMatchEvent): string => row.proId ?? stableRowId('lite-event', match, row.id);
const selectedIds = (row: LiteMatchRecord): string[] => [...new Set([...row.starters, ...row.bench, ...Object.keys(row.playerTimers)])];
const has = (map: object, key: string): boolean => Object.prototype.hasOwnProperty.call(map, key);

function playerResolver(roster: LiteRoster, row: LiteMatchRecord): (liteId: string) => string {
  const current = new Map(roster.players.map(player => [id(roster.liteIds[player.id] ?? player.id), uuid(player.id)]));
  const archived = new Map(row.players.map(player => [player.id, player.proId]));
  return liteId => current.get(liteId) ?? archived.get(liteId) ?? stableRowId('lite-player', roster.installationId, roster.teamId, liteId);
}
function eventActor(row: LiteMatchRecord, event: LiteMatchEvent, side: 'player' | 'in' | 'out'): string {
  const explicit = side === 'player' ? event.playerId : side === 'in' ? event.playerInId : event.playerOutId;
  if (explicit) return explicit;
  const name = side === 'player' ? event.playerName : side === 'in' ? event.playerIn : event.playerOut;
  const number = side === 'player' ? event.playerNumber : side === 'in' ? event.playerInNum : event.playerOutNum;
  const candidates = row.players.filter(player => name !== undefined && number !== undefined && player.name === name && player.number === number);
  if (candidates.length !== 1) throw new Error(`Match ${row.id}: event ${event.id} has an unresolved or ambiguous ${side} player.`);
  return candidates[0]!.id;
}

/** Run before merging: attach cloud identities without changing any existing Lite identities. */
export function canonicalMatches(roster: LiteRoster, snapshot: LiteMatches): LiteMatches {
  const clean = parseLiteMatches(snapshot, roster);
  const convert = (row: LiteMatchRecord): LiteMatchRecord => {
    const canonical = playerResolver(roster, row);
    const proId = matchId(roster, row);
    const events = row.events.map(event => ({ ...event, proId: eventId(proId, event), ...(event.type === 'Sub'
      ? { playerInId: eventActor(row, event, 'in'), playerOutId: eventActor(row, event, 'out') }
      : { playerId: eventActor(row, event, 'player') }) }));
    const players = row.players.map(player => ({ ...player, proId: canonical(player.id) }));
    // Referenced players missing from an old archive still need a portable identity for merge.
    const referenced = new Set([...selectedIds(row), ...events.flatMap(event =>
      [event.playerId, event.playerInId, event.playerOutId].filter((value): value is string => value !== undefined))]);
    for (const liteId of referenced) {
      if (players.some(player => player.id === liteId)) continue;
      const proPlayerId = canonical(liteId);
      const current = roster.players.find(player => player.id.toLowerCase() === proPlayerId);
      players.push({ id: liteId, proId: proPlayerId, name: current?.full_name ?? 'Former player', number: current?.shirt_number ?? 0,
        position: current?.position_tag ?? 'Unassigned' });
    }
    unique(players.map(player => player.proId), 'canonical player identity');
    return { ...row, proId, players, events };
  };
  const result = { ...clean, matches: clean.matches.map(convert), live: clean.live ? convert(clean.live) : null,
    removed: clean.removed.map(row => ({ ...row, proId: matchId(roster, row) })) };
  return parseLiteMatches(result, roster);
}

/** Canonical match rows and lineup seconds share the existing profile denominator/clamping rules. */
export function sharedMatchLog(roster: LiteRoster, snapshot: LiteMatches, playerId: string): PlayerMatchEntry[] {
  const clean = parseLiteMatches(snapshot, roster);
  const tombstones = new Map(clean.removed.map(row => [matchId(roster, row), row.recordedAt]));
  const rows = recordsOf(clean).filter(row => {
    const deletedAt = tombstones.get(matchId(roster, row));
    return row.status === 'completed' && (!deletedAt || compare(row.recordedAt, deletedAt) > 0);
  });
  return buildMatchLog(playerId, rows.map(row => ({ id: matchId(roster, row), title: row.title, opponent_name: row.opponent,
    match_date: row.date, status: row.status, duration_seconds: row.durationSeconds, recorded_at: row.recordedAt })),
  rows.flatMap(row => {
    const canonical = playerResolver(roster, row);
    return selectedIds(row).map(liteId => ({ match_id: matchId(roster, row), player_id: canonical(liteId),
      listed_as: row.starters.includes(liteId) ? 'starter' : 'bench', recorded_seconds: has(row.playerTimers, liteId) ? row.playerTimers[liteId]! : 0 }));
  }));
}

/** Pure writes, not enqueueing: the caller supplies the session and resolves removed child rows. */
export function matchInputs(roster: LiteRoster, snapshot: LiteMatches): OutboxInput[] {
  const canonical = canonicalMatches(roster, snapshot);
  const clean = mergeLiteMatches({ ...canonical, matches: [], live: null, removed: [] }, canonical);
  const teamId = roster.cloudTeamId === null ? stableRowId('lite-team', roster.installationId, roster.teamId) : uuid(roster.cloudTeamId);
  const inputs: OutboxInput[] = [];
  for (const row of recordsOf(clean)) {
    const rowId = row.proId!;
    const player = playerResolver(roster, row);
    const recordedAt = row.recordedAt;
    inputs.push({ table: 'matches', rowId, op: 'upsert', requiresRowId: null, recordedAt, payload: {
      team_id: teamId, title: row.title, opponent_name: row.opponent, match_date: row.date, team_format: Number(row.format), formation: row.formation,
      status: row.status, period_label: row.period, duration_seconds: row.durationSeconds, team_goals: row.ourGoals,
      opponent_goals: row.opponentGoals, ended_at: row.endedAt, recorded_at: recordedAt,
    } });
    for (const liteId of selectedIds(row)) {
      const playerId = player(liteId);
      inputs.push({ table: 'match_players', rowId: row.lineupIds && has(row.lineupIds, liteId) ? row.lineupIds[liteId]! : stableRowId('match-player', rowId, playerId),
        op: 'upsert', requiresRowId: rowId, recordedAt, payload: { match_id: rowId, player_id: playerId,
          listed_as: row.starters.includes(liteId) ? 'starter' : 'bench', recorded_seconds: has(row.playerTimers, liteId) ? row.playerTimers[liteId]! : 0 } });
    }
    // Goals precede their linked assists even if the Lite event array is newest-first.
    for (const event of [...row.events.filter(event => event.type !== 'Assist'), ...row.events.filter(event => event.type === 'Assist')]) {
      const payload: Record<string, unknown> = { match_id: rowId, period_label: event.period,
        match_time_seconds: event.matchTimeSeconds, recorded_at: recordedAt };
      let requiresRowId = rowId;
      if (event.type === 'Sub') {
        payload.kind = 'substitution';
        payload.actor_player_id = player(eventActor(row, event, 'in'));
        payload.second_player_id = player(eventActor(row, event, 'out'));
        if (payload.actor_player_id === payload.second_player_id) fail('substitution names the same player twice');
      } else {
        payload.kind = ({ Goal: 'goal', Assist: 'assist', Yellow: 'card_yellow', Red: 'card_red' } as const)[event.type];
        payload.actor_player_id = player(eventActor(row, event, 'player'));
        if (event.type === 'Assist') {
          const goal = row.events.find(candidate => candidate.type === 'Goal' && (candidate.id === event.goalId || candidate.proId === event.goalId));
          if (!goal) throw new Error(`Match ${row.id}: assist ${event.id} has no matching goal.`);
          requiresRowId = goal.proId!;
          payload.link_event_id = requiresRowId;
        }
      }
      // Parent recordedAt versions event edits too; timestamp remains the original event time.
      inputs.push({ table: 'match_events', rowId: event.proId!, op: 'upsert', requiresRowId, recordedAt, payload });
    }
  }
  for (const row of clean.removed) inputs.push({ table: 'matches', rowId: row.proId!, op: 'tombstone', payload: {}, requiresRowId: null, recordedAt: row.recordedAt });
  return inputs;
}

/** Throw instead of discarding a second non-completed match: the Lite schema has one live slot. */
function splitSnapshot(expected: MatchScope, revision: string, records: LiteMatchRecord[], removed: LiteMatchRemoved[]): LiteMatches {
  const active = records.filter(row => row.status !== 'completed').sort((a, b) => compare(b.recordedAt, a.recordedAt));
  if (active.length > 1) throw new Error('Multiple unfinished matches cannot fit the single Lite live slot. Resolve them before sharing matches.');
  return { version: 1, installationId: expected.installationId, teamId: expected.teamId, revision,
    matches: records.filter(row => row.status === 'completed').sort((a, b) => b.date.localeCompare(a.date) || compare(b.recordedAt, a.recordedAt)),
    live: active[0] ?? null, removed };
}

/** Strict joined server response; RLS/team filtering is the caller's responsibility. */
export function cloudMatches(roster: LiteRoster, data: unknown): LiteMatches {
  liteMatchesKey(roster);
  const records: LiteMatchRecord[] = [];
  const removed: LiteMatchRemoved[] = [];
  const revisions = [iso(roster.revision)];
  for (const value of list(data, 'cloud matches')) {
    const raw = object(value, 'cloud match');
    const proId = uuid(raw.id);
    if (raw.team_id !== undefined && uuid(raw.team_id) !== (roster.cloudTeamId ?? stableRowId('lite-team', roster.installationId, roster.teamId))) fail('foreign cloud team');
    const recordedAt = iso(raw.recorded_at);
    const deletedAt = raw.deleted_at === null ? null : iso(raw.deleted_at);
    revisions.push(recordedAt, ...(deletedAt ? [deletedAt] : []));
    const players = new Map<string, LiteMatchPlayer>();
    const litePlayer = (value: unknown): LiteMatchPlayer => {
      const proId = uuid(value);
      let player = players.get(proId);
      if (!player) {
        const current = roster.players.find(row => row.id.toLowerCase() === proId);
        player = { id: id(roster.liteIds[proId] ?? proId), proId, name: current?.full_name ?? 'Former player',
          number: current?.shirt_number ?? 0, position: current?.position_tag ?? 'Unassigned' };
        players.set(proId, player);
      }
      return player;
    };
    const lineupIds: Record<string, string> = Object.fromEntries([]);
    const playerTimers: Record<string, number> = Object.fromEntries([]);
    const starters: string[] = [];
    const bench: string[] = [];
    const lineup = list(raw.match_players, 'cloud lineup');
    const lineupRows: string[] = [];
    for (const value of lineup) {
      const row = object(value, 'cloud lineup row');
      const rowId = uuid(row.id);
      const player = litePlayer(row.player_id);
      if (has(lineupIds, player.id)) fail('duplicate cloud lineup player');
      if (row.listed_as !== 'starter' && row.listed_as !== 'bench') fail('cloud lineup role');
      lineupRows.push(rowId);
      Object.defineProperty(lineupIds, player.id, { value: rowId, enumerable: true, configurable: true, writable: true });
      Object.defineProperty(playerTimers, player.id, { value: row.recorded_seconds === null ? 0 : integer(row.recorded_seconds), enumerable: true, configurable: true, writable: true });
      (row.listed_as === 'starter' ? starters : bench).push(player.id);
    }
    unique(lineupRows, 'cloud lineup row');
    const events: LiteMatchEvent[] = [];
    const allEventIds: string[] = [];
    for (const value of list(raw.match_events, 'cloud events')) {
      const row = object(value, 'cloud event');
      const eventId = uuid(row.id);
      allEventIds.push(eventId);
      const actor = litePlayer(row.actor_player_id);
      const second = row.second_player_id === null ? null : litePlayer(row.second_player_id);
      const link = row.link_event_id === null ? null : uuid(row.link_event_id);
      const kind = row.kind;
      if (kind !== 'goal' && kind !== 'assist' && kind !== 'substitution' && kind !== 'card_yellow' && kind !== 'card_red') return fail('cloud event kind');
      if ((kind === 'assist' && (!link || link === eventId)) || (kind === 'substitution' && (!second || second.proId === actor.proId))) fail('cloud event references');
      const event: LiteMatchEvent = { id: eventId, proId: eventId,
        type: ({ goal: 'Goal', assist: 'Assist', substitution: 'Sub', card_yellow: 'Yellow', card_red: 'Red' } as const)[kind],
        period: period(row.period_label), matchTimeSeconds: integer(row.match_time_seconds), timestamp: iso(row.recorded_at),
        ...(kind === 'substitution' ? { playerInId: actor.id, playerOutId: second!.id, playerIn: actor.name, playerInNum: actor.number,
          playerOut: second!.name, playerOutNum: second!.number } : { playerId: actor.id, playerName: actor.name, playerNumber: actor.number }),
        ...(link ? { goalId: link } : {}) };
      const eventDeletedAt = row.deleted_at === null ? null : iso(row.deleted_at);
      if (!eventDeletedAt) events.push(event);
      revisions.push(event.timestamp, ...(eventDeletedAt ? [eventDeletedAt] : []));
    }
    unique(allEventIds, 'cloud event');
    for (const event of events) {
      if (event.type === 'Assist' && !events.some(goal => goal.type === 'Goal' && goal.id === event.goalId)) fail('cloud assist has no live goal');
    }
    const row: LiteMatchRecord = { id: proId, proId, title: text(raw.title), teamName: text(roster.teamName), opponent: text(raw.opponent_name),
      date: date(raw.match_date), format: format(typeof raw.team_format === 'number' ? String(raw.team_format) : null), formation: raw.formation === null ? '' : text(raw.formation, 40, true),
      status: status(raw.status), period: period(raw.period_label), durationSeconds: integer(raw.duration_seconds),
      ourGoals: integer(raw.team_goals), opponentGoals: integer(raw.opponent_goals), endedAt: raw.ended_at === null ? null : iso(raw.ended_at), recordedAt,
      players: [...players.values()], starters, bench, playerTimers, lineupIds, events };
    if (deletedAt) removed.push({ id: proId, proId, recordedAt: newest([recordedAt, deletedAt]) });
    // Lite has one live slot and an archive of finished games, so an unplayed fixture has no
    // place in its snapshot. It stays in the club database, and in Pro's own match cache.
    else if (row.status !== 'scheduled') records.push(row);
  }
  unique([...records.map(row => row.id), ...removed.map(row => row.id)], 'cloud match');
  return parseLiteMatches(splitSnapshot(roster, newest(revisions), records, removed), roster);
}

const identity = (row: { id: string; proId?: string }): string => row.proId ?? row.id;
function retainLiteIds(winner: LiteMatchRecord, local: LiteMatchRecord, remote: LiteMatchRecord | undefined): LiteMatchRecord {
  const players = new Map(local.players.map(player => [identity(player), player.id]));
  const events = new Map(local.events.map(event => [identity(event), event.id]));
  const playerId = (value: string): string => {
    const player = winner.players.find(player => player.id === value);
    return players.get(player ? identity(player) : value) ?? value;
  };
  const eventId = (value: string): string => {
    const event = winner.events.find(event => event.id === value || event.proId === value);
    return events.get(event ? identity(event) : value) ?? value;
  };
  const remapLineup = (row: LiteMatchRecord): [string, string][] => Object.entries(row.lineupIds ?? {}).map(([key, value]) => {
    const player = row.players.find(player => player.id === key);
    return [players.get(player ? identity(player) : key) ?? key, value];
  });
  const lineupIds = Object.fromEntries([...(remote ? remapLineup(remote) : []), ...remapLineup(local)]);
  return { ...winner, id: local.id, players: winner.players.map(player => ({ ...player, id: playerId(player.id) })),
    starters: winner.starters.map(playerId), bench: winner.bench.map(playerId),
    playerTimers: Object.fromEntries(Object.entries(winner.playerTimers).map(([key, value]) => [playerId(key), value])),
    ...(local.lineupIds !== undefined || remote?.lineupIds !== undefined ? { lineupIds } : {}),
    events: winner.events.map(event => ({ ...event, id: eventId(event.id),
      ...(event.playerId === undefined ? {} : { playerId: playerId(event.playerId) }),
      ...(event.playerInId === undefined ? {} : { playerInId: playerId(event.playerInId) }),
      ...(event.playerOutId === undefined ? {} : { playerOutId: playerId(event.playerOutId) }),
      ...(event.goalId === undefined ? {} : { goalId: eventId(event.goalId) }) })) };
}

/** Canonicalise both sources first. Row versions win; ties favour remote, except deletion wins. */
export function mergeLiteMatches(local: LiteMatches, remote: LiteMatches): LiteMatches {
  const left = parseLiteMatches(local, local);
  const right = parseLiteMatches(remote, left);
  const localRows = new Map(recordsOf(left).map(row => [identity(row), row]));
  const remoteRows = new Map(recordsOf(right).map(row => [identity(row), row]));
  const rows = new Map(localRows);
  for (const [key, row] of remoteRows) {
    const old = rows.get(key);
    if (!old || compare(row.recordedAt, old.recordedAt) >= 0) rows.set(key, row);
  }
  const removed = new Map<string, LiteMatchRemoved>();
  for (const row of [...left.removed, ...right.removed]) {
    const old = removed.get(identity(row));
    if (!old || compare(row.recordedAt, old.recordedAt) >= 0) removed.set(identity(row), row);
  }
  for (const [key, tombstone] of removed) {
    const row = rows.get(key);
    if (!row || compare(tombstone.recordedAt, row.recordedAt) >= 0) rows.delete(key);
    else removed.delete(key);
  }
  const records = [...rows].map(([key, row]) => {
    const old = localRows.get(key);
    return old ? retainLiteIds(row, old, remoteRows.get(key)) : row;
  });
  const tombstones = [...removed].map(([key, row]) => ({ ...row,
    id: localRows.get(key)?.id ?? left.removed.find(old => identity(old) === key)?.id ?? row.id }));
  const revision = newest([left.revision, right.revision, ...records.map(row => row.recordedAt), ...tombstones.map(row => row.recordedAt)]);
  return parseLiteMatches(splitSnapshot(left, revision, records, tombstones), left);
}

/**
 * Rows this device authored. A match that came from the club database carries the same value in
 * `id` and `proId`, so uploading it back would re-write another coach's row and its `updated_at`
 * stamp for no reason. Only Lite's own rows go into the queue.
 */
export function liteAuthored(snapshot: LiteMatches): LiteMatches {
  const clean = parseLiteMatches(snapshot, snapshot);
  const native = (row: { id: string; proId?: string }): boolean => row.proId === undefined || row.id !== row.proId;
  return { ...clean, matches: clean.matches.filter(native), live: clean.live && native(clean.live) ? clean.live : null,
    removed: clean.removed.filter(native) };
}

/**
 * What this device pushes: its own rows, and only once a match has actually been started. Every
 * Lite team opens with a blank "Match 1" against sample data, and an unplayed fixture has no more
 * place in the club database than the club's fixtures have in Lite's file. A started match is real
 * data even when the clock is stopped, so `paused` and `in_progress` still go up.
 */
export function liteUpload(snapshot: LiteMatches): LiteMatches {
  const native = liteAuthored(snapshot);
  return { ...native, live: native.live && native.live.status !== 'scheduled' ? native.live : null };
}

/** Advancing revision in the exact three-decimal format Lite re-validates on arrival. */
export const nextRevision = (previous: string | null): string =>
  new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();

/**
 * Key-order independent content hash, and it drops the revision: Lite and Pro both build these
 * objects from merged sources, so a comparison that trusted property order would republish the
 * same history on every poll and keep the two apps notifying each other.
 */
export function matchesFingerprint(snapshot: LiteMatches): string {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value) ? value.map(sorted)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value as object).sort().map(key => [key, sorted((value as Record<string, unknown>)[key])]))
        : value;
  const { revision: _revision, ...content } = parseLiteMatches(snapshot, snapshot);
  return JSON.stringify(sorted(content));
}
