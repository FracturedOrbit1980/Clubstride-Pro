import type { Membership } from '../../core/context/AuthContext';
import { stableRowId } from '../../core/sync/stableId';
import type { OutboxInput } from '../../core/sync/outbox';
import type { SquadPlayerRow } from '../coach/attendance/squad';

export const LITE_ROSTER_KEY = 'cs.lite.roster.v1';

export interface LiteRoster {
  installationId: string;
  teamId: string;
  teamName: string;
  revision: string;
  players: SquadPlayerRow[];
  liteIds: Record<string, string>;
  cloudTeamId: string | null;
  ownerId: string | null;
  readOnly: boolean;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const validSharedText = (value: string, limit = 200): boolean =>
  !!value.trim() && value.length <= limit && !/[<>\u0000-\u001f\u007f]/.test(value);

export interface LiteConnection {
  installationId: string;
  liteTeamId: string;
  teamId: string;
  revision: string;
  idMap: Record<string, string>;
  players: SquadPlayerRow[];
}

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function parseLiteRoster(value: unknown): LiteRoster {
  const raw = object(value);
  if (!raw || raw.version !== 1 || typeof raw.installationId !== 'string' || !raw.installationId ||
      typeof raw.teamId !== 'string' || !raw.teamId || typeof raw.teamName !== 'string' || !validSharedText(raw.teamName) ||
      typeof raw.revision !== 'string' || !Number.isFinite(Date.parse(raw.revision)) || !Array.isArray(raw.players)) {
    throw new Error('The Lite squad on this device could not be read. Open Lite and save it again.');
  }
  if ((raw.cloudTeamId !== undefined && (typeof raw.cloudTeamId !== 'string' || !uuid.test(raw.cloudTeamId))) ||
      (raw.ownerId !== undefined && (typeof raw.ownerId !== 'string' || !raw.ownerId)) ||
      (raw.readOnly !== undefined && typeof raw.readOnly !== 'boolean')) {
    throw new Error('The shared squad scope could not be read.');
  }
  const ids = new Set<string>();
  const proIds = new Set<string>();
  const liteIds: Record<string, string> = {};
  const players = raw.players.map(value => {
    const row = object(value);
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.name !== 'string' || !validSharedText(row.name) ||
        typeof row.number !== 'number' || !Number.isInteger(row.number) || row.number < 0 || row.number > 99 || typeof row.position !== 'string' || !validSharedText(row.position, 40) ||
        (row.proId !== undefined && (typeof row.proId !== 'string' || !uuid.test(row.proId))) ||
        (row.available !== undefined && typeof row.available !== 'boolean')) {
      throw new Error('A Lite player has an invalid name, identity, shirt number or position. Correct the squad in Lite first.');
    }
    ids.add(row.id);
    const id = typeof row.proId === 'string' ? row.proId : stableRowId('lite-player', raw.installationId as string, raw.teamId as string, row.id);
    if (proIds.has(id)) throw new Error('Two shared players have the same identity.');
    proIds.add(id);
    liteIds[id] = row.id;
    return {
      id,
      full_name: row.name.trim(),
      shirt_number: row.number,
      position_tag: ({ GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' } as Record<string, string>)[row.position] ?? row.position,
      available: row.available !== false,
    };
  });
  players.sort((a, b) => a.shirt_number - b.shirt_number);
  return { installationId: raw.installationId, teamId: raw.teamId, teamName: raw.teamName.trim(), revision: raw.revision, players,
    liteIds, cloudTeamId: typeof raw.cloudTeamId === 'string' ? raw.cloudTeamId : null,
    ownerId: typeof raw.ownerId === 'string' ? raw.ownerId : null, readOnly: raw.readOnly === true };
}

export const localMembership = (roster: LiteRoster): Membership => ({
  teamId: roster.cloudTeamId ?? stableRowId('lite-team', roster.installationId, roster.teamId),
  teamName: roster.teamName,
  role: roster.readOnly ? 'parent' : 'coach',
});

export function rosterSnapshot(roster: LiteRoster, players: readonly SquadPlayerRow[], revision: string,
  club?: { membership: Membership; ownerId: string; connection: LiteConnection | null }) {
  return {
    version: 1, installationId: roster.installationId, teamId: roster.teamId,
    teamName: club?.membership.teamName ?? roster.teamName, revision,
    ...(club ? { cloudTeamId: club.membership.teamId, ownerId: club.ownerId, readOnly: club.membership.role === 'parent' }
      : roster.cloudTeamId ? { cloudTeamId: roster.cloudTeamId, ownerId: roster.ownerId, readOnly: roster.readOnly } : {}),
    players: players.map(player => {
      const localId = Object.keys(club?.connection?.idMap ?? {}).find(id => club?.connection?.idMap[id] === player.id);
      return {
        id: roster.liteIds[player.id] ?? (localId ? roster.liteIds[localId] : undefined) ?? player.id,
        proId: player.id, name: player.full_name, number: player.shirt_number,
        position: ({ Goalkeeper: 'GK', Defender: 'DEF', Midfielder: 'MID', Forward: 'FWD' } as Record<string, string>)[player.position_tag ?? ''] ?? player.position_tag ?? 'Unassigned',
        available: player.available,
      };
    }),
  };
}

export function clubRoster(roster: LiteRoster, connection: LiteConnection | null, membership: Membership,
  ownerId: string, players: readonly SquadPlayerRow[], revision: string): LiteRoster {
  return parseLiteRoster(rosterSnapshot(roster, players, revision, { membership, ownerId, connection }));
}

export function mergeInitialRoster(roster: LiteRoster, connection: LiteConnection, existing: readonly SquadPlayerRow[]): SquadPlayerRow[] {
  const local = planLiteSync(roster, connection).next.players;
  return [...existing.filter(player => !local.some(row => row.id === player.id)), ...local]
    .sort((a, b) => a.shirt_number - b.shirt_number);
}

export const connectionKey = (userId: string, roster: LiteRoster): string =>
  `cs.lite.connection.v1.${userId}.${roster.installationId}.${roster.teamId}`;

export function parseLiteConnection(value: unknown, roster: LiteRoster): LiteConnection | null {
  const raw = object(value);
  const map = raw ? object(raw.idMap) : null;
  if (!raw || raw.installationId !== roster.installationId || raw.liteTeamId !== roster.teamId ||
      typeof raw.teamId !== 'string' || typeof raw.revision !== 'string' || !map ||
      Object.values(map).some(id => typeof id !== 'string') || !Array.isArray(raw.players)) return null;
  for (const value of raw.players) {
    const player = object(value);
    if (!player || typeof player.id !== 'string' || typeof player.full_name !== 'string' ||
        typeof player.shirt_number !== 'number' || typeof player.available !== 'boolean' ||
        (player.position_tag !== null && typeof player.position_tag !== 'string')) return null;
  }
  return raw as unknown as LiteConnection;
}

export function connectLiteRoster(roster: LiteRoster, membership: Membership, existing: readonly SquadPlayerRow[]): LiteConnection {
  if (membership.role === 'parent') throw new Error('Only a manager or coach can connect a Lite squad.');
  const idMap: Record<string, string> = {};
  const numbers = new Set<number>();
  for (const player of roster.players) {
    if (player.shirt_number < 1) throw new Error('Give each player a shirt number from 1 to 99 before cloud sync.');
    if (numbers.has(player.shirt_number)) throw new Error(`Two Lite players wear #${player.shirt_number}. Give each player a unique number before cloud sync.`);
    numbers.add(player.shirt_number);
    const sameId = existing.find(row => row.id === player.id);
    const sameNumber = existing.find(row => row.shirt_number === player.shirt_number);
    if (sameNumber && sameNumber.id !== sameId?.id && sameNumber.full_name !== player.full_name) {
      throw new Error(`#${player.shirt_number} belongs to ${sameNumber.full_name} in ${membership.teamName}. No players were imported; correct the number in Lite first.`);
    }
    idMap[player.id] = sameId?.id ?? sameNumber?.id ?? player.id;
  }
  const players = roster.players.flatMap(player => {
    const match = existing.find(row => row.id === idMap[player.id]);
    return match ? [match] : [];
  });
  return { installationId: roster.installationId, liteTeamId: roster.teamId, teamId: membership.teamId, revision: '', idMap, players };
}

export function planLiteSync(roster: LiteRoster, connection: LiteConnection): { inputs: OutboxInput[]; next: LiteConnection } {
  if (roster.installationId !== connection.installationId || roster.teamId !== connection.liteTeamId) {
    throw new Error('The Lite squad no longer matches this connection.');
  }
  const idMap = { ...connection.idMap };
  const players = roster.players.map(player => {
    const id = idMap[player.id] ?? player.id;
    idMap[player.id] = id;
    const existing = connection.players.find(row => row.id === id);
    return { ...player, id, available: existing?.available ?? player.available };
  });
  const numbers = new Set<number>();
  for (const player of players) {
    if (player.shirt_number < 1) throw new Error('Cloud sync is paused until every player has a shirt number from 1 to 99.');
    if (numbers.has(player.shirt_number)) throw new Error(`Two Lite players wear #${player.shirt_number}. Cloud sync is paused until their numbers are unique.`);
    numbers.add(player.shirt_number);
  }
  const inputs: OutboxInput[] = [];
  for (const player of players) {
    const previous = connection.players.find(row => row.id === player.id);
    if (previous && JSON.stringify(previous) === JSON.stringify(player)) continue;
    if (previous && previous.shirt_number !== player.shirt_number && connection.players.some(row => row.id !== player.id && row.shirt_number === player.shirt_number)) {
      throw new Error('Cloud sync is paused: shirt numbers cannot be swapped while another player holds that number. Use an unused number first.');
    }
    inputs.push({ table: 'players', rowId: player.id, op: 'upsert', requiresRowId: null, recordedAt: roster.revision,
      payload: { team_id: connection.teamId, full_name: player.full_name, shirt_number: player.shirt_number, position_tag: player.position_tag, available: player.available } });
  }
  for (const previous of connection.players) {
    if (!players.some(row => row.id === previous.id)) inputs.unshift({ table: 'players', rowId: previous.id, op: 'tombstone', payload: {}, requiresRowId: null, recordedAt: roster.revision });
  }
  return { inputs, next: { ...connection, revision: roster.revision, idMap, players } };
}
