// Shared Lite match history: parsing, canonical identities, queue payloads and merge rules.
import assert from 'node:assert/strict';
import { assertQueuedPayload } from '../src/core/sync/contracts';
import { stableRowId } from '../src/core/sync/stableId';
import {
  LITE_MATCHES_PREFIX, canonicalMatches, cloudMatches, liteAuthored, liteMatchesKey, liteUpload, matchInputs,
  matchesFingerprint, mergeLiteMatches, nextRevision, parseLiteMatches, serializeLiteMatches, sharedMatchLog,
} from '../src/features/shared/liteMatches';
import { parseLiteRoster } from '../src/features/shared/liteRoster';
import type { LiteMatches, LiteMatchEvent, LiteMatchRecord } from '../src/features/shared/liteMatches';

const TEAM = 'cf00a741-af7c-444f-8876-b874d784bd3b';
const GOAL_EVENT = '2f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0';
const LINEUP_ONE = 'c7b68512-228c-4d93-9002-eb0f9774ec70';
const CLOUD_PLAYER = '7cc2214c-6525-4093-b91c-e48cc12933a5';

const rosterValue = { version: 1, installationId: 'device-a', teamId: 'team-a', teamName: 'Local United',
  revision: '2026-10-28T10:00:00.000Z',
  players: [{ id: 'p_one', name: 'Sam Local', number: 7, position: 'MID' }, { id: 'p_two', name: 'Alex Local', number: 1, position: 'GK' }] };
const roster = parseLiteRoster(rosterValue);
const sam = roster.players.find(player => player.shirt_number === 7)!;
const alex = roster.players.find(player => player.shirt_number === 1)!;

const event = (id: string, extra: Record<string, unknown>): LiteMatchEvent =>
  ({ id, matchTimeSeconds: 600, period: '1st Half', timestamp: '2026-10-27T10:10:00.000Z', ...extra }) as unknown as LiteMatchEvent;
const goal = event('e_goal', { type: 'Goal', playerId: 'p_one', playerName: 'Sam Local', playerNumber: 7 });
const assist = event('e_assist', { type: 'Assist', playerId: 'p_two', playerName: 'Alex Local', playerNumber: 1, goalId: 'e_goal' });
const sub = event('e_sub', { type: 'Sub', period: '2nd Half', matchTimeSeconds: 2400, playerInId: 'p_two', playerOutId: 'p_one' });
// An archived Lite match from before events carried ids only names the player.
const card = event('e_card', { type: 'Yellow', playerName: 'Sam Local', playerNumber: 7 });

const finished: LiteMatchRecord = { id: 'm_one', title: 'Match 1', teamName: 'Local United', opponent: 'Rivals FC',
  date: '2026-10-27', format: '7', formation: '2-1-2', ourGoals: 3, opponentGoals: 1, durationSeconds: 3000,
  period: '2nd Half', status: 'completed', endedAt: '2026-10-27T11:00:00.000Z', recordedAt: '2026-10-27T11:00:05.000Z',
  playerTimers: { p_one: 2400, p_two: 600 }, starters: ['p_one'], bench: ['p_two'],
  players: [{ id: 'p_one', name: 'Sam Local', number: 7, position: 'MID' }, { id: 'p_two', name: 'Alex Local', number: 1, position: 'GK' }],
  events: [assist, goal, sub, card] };
// Assist listed first on purpose: Lite stores events newest-first and the goal must still flush first.
const value = { version: 1, installationId: 'device-a', teamId: 'team-a', revision: '2026-10-28T10:00:00.000Z',
  matches: [finished], live: null, removed: [] };
const live = (extra: Record<string, unknown>): Record<string, unknown> =>
  ({ ...finished, id: 'm_live', status: 'in_progress', period: '1st Half', endedAt: null, recordedAt: '2026-10-28T10:30:00.000Z', ...extra });

const matchUuid = stableRowId('lite-match', 'device-a', 'team-a', 'm_one');
const goalUuid = stableRowId('lite-event', matchUuid, 'e_goal');
const teamUuid = stableRowId('lite-team', 'device-a', 'team-a');

/** Same content, keys inserted in alphabetical order - what a merged object looks like on disk. */
const sortedKeys = <T,>(input: T): T => JSON.parse(JSON.stringify(input, (_key, item: unknown) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
    : item));

const read = (extra: Record<string, unknown>): LiteMatches => parseLiteMatches({ ...value, ...extra }, roster);

export const done = (async () => {
  assert.equal(liteMatchesKey(roster), `${LITE_MATCHES_PREFIX}device-a.team-a`);
  assert.throws(() => liteMatchesKey({ installationId: 'device/a', teamId: 'team-a' }));

  const snapshot = read({});
  assert.equal(snapshot.matches[0]?.title, 'Match 1');
  assert.equal(snapshot.matches[0]?.events[1]?.type, 'Goal');
  assert.equal(snapshot.matches[0]?.players[0]?.id, 'p_one');
  assert.equal(snapshot.live, null);
  assert.deepEqual(read({ matches: [], live: live({}) }).live?.id, 'm_live');
  assert.equal(parseLiteMatches(value, roster).revision, '2026-10-28T10:00:00.000Z');
  assert.throws(() => parseLiteMatches(null, roster));
  assert.throws(() => parseLiteMatches({ ...value, version: 2 }, roster));
  assert.throws(() => parseLiteMatches({ ...value, installationId: 'device-b' }, roster), /foreign scope/);
  assert.throws(() => parseLiteMatches({ ...value, teamId: 'team-b' }, roster), /foreign scope/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [finished, finished] }, roster), /duplicate match identity/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [finished], live: { ...finished, status: 'paused' } }, roster), /duplicate match identity/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, opponent: '<b>Rivals</b>' }] }, roster), /plain text/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, title: '' }] }, roster), /plain text/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, formation: undefined }] }, roster));
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, ourGoals: -1 }] }, roster), /integer/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, durationSeconds: 1.5 }] }, roster), /integer/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, format: '8' }] }, roster), /format/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, date: '2026-02-30' }] }, roster), /calendar date/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, status: 'cancelled' }] }, roster), /status/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, period: 'Extra time' }] }, roster), /period/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, bench: ['p_two', 'p_two'] }] }, roster), /duplicate bench/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, starters: ['p_two'] }] }, roster), /duplicate lineup player/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, playerTimers: { p_one: '2400' } }] }, roster), /integer/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, events: [event('e_pen', { type: 'Penalty', playerId: 'p_one' })] }] }, roster), /event type/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, events: [goal, goal] }] }, roster), /duplicate event identity/);
  // Lite stamps events with epoch milliseconds; the wire format must be ISO before Pro accepts them.
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, events: [{ ...goal, timestamp: 1761548400000 }] }] }, roster), /ISO timestamp/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, events: [{ ...goal, playerId: 'p one' }] }] }, roster), /identity/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, lineupIds: { p_one: 'not-a-uuid' } }] }, roster), /cloud UUID/);
  assert.throws(() => parseLiteMatches({ ...value, matches: [{ ...finished, lineupIds: { p_one: LINEUP_ONE, p_two: LINEUP_ONE } }] }, roster), /duplicate lineup row identity/);
  assert.throws(() => parseLiteMatches({ ...value, removed: [{ id: 'm_one', recordedAt: 'tomorrow' }] }, roster), /ISO timestamp/);
  assert.equal(Object.keys(parseLiteMatches({ ...value, smuggled: 'x', created_by: 'y' }, roster).matches[0]!).includes('smuggled'), false);
  assert.equal(parseLiteMatches(JSON.parse(serializeLiteMatches(snapshot)), roster).revision, snapshot.revision);
  assert.throws(() => serializeLiteMatches({ ...snapshot, installationId: 'device-z' }, roster));

  const canonical = canonicalMatches(roster, snapshot);
  const canonicalMatch = canonical.matches[0]!;
  assert.equal(canonicalMatch.id, 'm_one');
  assert.equal(canonicalMatch.proId, matchUuid);
  assert.equal(canonicalMatch.players.find(player => player.id === 'p_one')?.proId, sam.id);
  assert.equal(canonicalMatch.players.find(player => player.id === 'p_two')?.proId, alex.id);
  assert.equal(canonicalMatch.events.find(event => event.id === 'e_card')?.playerId, 'p_one');
  assert.equal(canonicalMatch.events.find(event => event.id === 'e_assist')?.proId, stableRowId('lite-event', matchUuid, 'e_assist'));
  assert.equal(canonicalMatches(roster, snapshot).revision, snapshot.revision);
  // A squad adopted by the club keeps the cloud identity instead of the deterministic one.
  const cloudSquad = parseLiteRoster({ ...rosterValue, players: [{ ...rosterValue.players[0]!, proId: CLOUD_PLAYER }, rosterValue.players[1]!] });
  const adopted = canonicalMatches(cloudSquad, snapshot);
  assert.equal(adopted.matches[0]?.players.find(player => player.id === 'p_one')?.proId, CLOUD_PLAYER);
  const adoptedInputs = matchInputs(cloudSquad, adopted);
  assert.equal(adoptedInputs.find(input => input.table === 'match_players')?.payload.player_id, CLOUD_PLAYER);
  assert.equal(adoptedInputs.filter(input => input.table === 'match_players' && input.payload.player_id === sam.id).length, 0);
  const orphaned = read({ matches: [{ ...finished, playerTimers: { p_one: 300, p_gone: 120 } }] });
  assert.equal(canonicalMatches(roster, orphaned).matches[0]?.players.find(player => player.id === 'p_gone')?.name, 'Former player');
  assert.equal(canonicalMatches(roster, orphaned).matches[0]?.players.find(player => player.id === 'p_gone')?.proId,
    stableRowId('lite-player', 'device-a', 'team-a', 'p_gone'));
  assert.throws(() => canonicalMatches(roster, read({ matches: [{ ...finished, events: [card],
    players: [...finished.players, { id: 'p_three', name: 'Sam Local', number: 7, position: 'DEF' }] }] })), /ambiguous/);
  assert.throws(() => canonicalMatches(roster, read({ matches: [{ ...finished, events: [event('e_ghost', { type: 'Goal' })] }] })), /unresolved/);

  const inputs = matchInputs(roster, snapshot);
  for (const input of inputs) if (input.op === 'upsert') assert.doesNotThrow(() => assertQueuedPayload(input.table, input.payload));
  assert.deepEqual(matchInputs(roster, snapshot), inputs);
  assert.equal(inputs.filter(input => input.table === 'matches').length, 1);
  assert.equal(inputs.find(input => input.table === 'matches')?.rowId, matchUuid);
  assert.equal(inputs.find(input => input.table === 'matches')?.requiresRowId, null);
  assert.equal(inputs.find(input => input.table === 'matches')?.payload.team_id, teamUuid);
  assert.equal(inputs.find(input => input.table === 'matches')?.payload.team_format, 7);
  assert.equal(inputs.find(input => input.table === 'matches')?.payload.period_label, '2nd Half');
  assert.equal(inputs.find(input => input.table === 'matches')?.payload.ended_at, '2026-10-27T11:00:00.000Z');
  assert.equal(matchInputs({ ...roster, cloudTeamId: TEAM }, snapshot).find(input => input.table === 'matches')?.payload.team_id, TEAM);
  const lineup = inputs.filter(input => input.table === 'match_players');
  assert.equal(lineup.length, 2);
  assert.equal(lineup.every(input => input.requiresRowId === matchUuid), true);
  assert.equal(lineup.find(input => input.payload.player_id === sam.id)?.payload.listed_as, 'starter');
  assert.equal(lineup.find(input => input.payload.player_id === sam.id)?.payload.recorded_seconds, 2400);
  assert.equal(lineup.find(input => input.payload.player_id === sam.id)?.rowId, stableRowId('match-player', matchUuid, sam.id));
  assert.equal(lineup.find(input => input.payload.player_id === alex.id)?.payload.listed_as, 'bench');
  assert.equal(inputs.filter(input => input.table === 'match_events').length, 4);
  const kinds = inputs.filter(input => input.table === 'match_events').map(input => input.payload.kind);
  assert.ok(kinds.indexOf('goal') < kinds.indexOf('assist'));
  assert.equal(kinds.indexOf('assist') > kinds.indexOf('substitution'), true);
  const assistInput = inputs.find(input => input.payload.kind === 'assist')!;
  assert.equal(assistInput.requiresRowId, goalUuid);
  assert.equal(assistInput.payload.link_event_id, goalUuid);
  assert.equal(assistInput.payload.actor_player_id, alex.id);
  const substitution = inputs.find(input => input.payload.kind === 'substitution')!;
  assert.equal(substitution.payload.actor_player_id, alex.id);
  assert.equal(substitution.payload.second_player_id, sam.id);
  assert.equal(substitution.requiresRowId, matchUuid);
  assert.equal(inputs.find(input => input.payload.kind === 'card_yellow')?.payload.actor_player_id, sam.id);
  assert.equal(inputs.find(input => input.op === 'tombstone'), undefined);
  assert.equal(matchInputs(roster, read({ matches: [], live: null })).length, 0);
  const reused = matchInputs(roster, read({ matches: [{ ...finished, lineupIds: { p_one: LINEUP_ONE } }] }));
  assert.equal(reused.find(input => input.payload.player_id === sam.id && input.table === 'match_players')?.rowId, LINEUP_ONE);
  assert.equal(reused.find(input => input.payload.player_id === alex.id && input.table === 'match_players')?.rowId,
    stableRowId('match-player', matchUuid, alex.id));
  const deleted = matchInputs(roster, read({ removed: [{ id: 'm_old', recordedAt: '2026-10-26T09:00:00.000Z' }] }));
  assert.equal(deleted.filter(input => input.op === 'tombstone').length, 1);
  assert.equal(deleted.find(input => input.op === 'tombstone')?.table, 'matches');
  assert.equal(deleted.find(input => input.op === 'tombstone')?.rowId, stableRowId('lite-match', 'device-a', 'team-a', 'm_old'));
  assert.deepEqual(deleted.find(input => input.op === 'tombstone')?.payload, {});
  assert.equal(deleted.find(input => input.op === 'tombstone')?.recordedAt, '2026-10-26T09:00:00.000Z');
  assert.throws(() => matchInputs(roster, read({ matches: [{ ...finished, events: [{ ...sub, playerOutId: 'p_two' }] }] })), /same player twice/);
  assert.throws(() => matchInputs(roster, read({ matches: [{ ...finished, events: [assist] }] })), /no matching goal/);

  const server = { id: matchUuid, team_id: TEAM, title: 'Match 1', opponent_name: 'Rivals FC', match_date: '2026-10-27',
    team_format: 7, formation: '2-1-2', status: 'completed', period_label: '2nd Half', duration_seconds: 3000,
    team_goals: 3, opponent_goals: 1, ended_at: '2026-10-27T11:00:00.000Z', recorded_at: '2026-10-27T11:00:05.000Z', deleted_at: null,
    match_players: [{ id: LINEUP_ONE, player_id: sam.id, listed_as: 'starter', recorded_seconds: 2400 },
      { id: GOAL_EVENT, player_id: alex.id, listed_as: 'bench', recorded_seconds: null }],
    match_events: [{ id: goalUuid, kind: 'goal', actor_player_id: sam.id, second_player_id: null, link_event_id: null,
      period_label: '1st Half', match_time_seconds: 600, recorded_at: '2026-10-27T10:10:00.000Z', deleted_at: null }] };
  const cloudRoster = { ...roster, cloudTeamId: TEAM };
  const cloud = cloudMatches(cloudRoster, [server]);
  assert.equal(cloud.matches[0]?.id, matchUuid);
  assert.equal(cloud.matches[0]?.proId, matchUuid);
  assert.equal(cloud.matches[0]?.starters.join(), 'p_one');
  assert.equal(cloud.matches[0]?.bench.join(), 'p_two');
  assert.equal(cloud.matches[0]?.playerTimers.p_two, 0);
  assert.equal(cloud.matches[0]?.lineupIds?.p_one, LINEUP_ONE);
  assert.equal(cloud.matches[0]?.events[0]?.id, goalUuid);
  assert.equal(cloud.live, null);
  assert.deepEqual(liteAuthored(cloud).matches, []);
  assert.equal(liteAuthored(canonical).matches.length, 1);
  // Lite starts every team with a blank slot against sample data, so an unstarted match is
  // bookkeeping rather than something the coach recorded. A stopped clock is still a real match.
  assert.equal(liteUpload(read({ matches: [], live: live({ status: 'scheduled' }) })).live, null);
  assert.equal(liteUpload(read({ matches: [], live: live({ status: 'paused' }) })).live?.id, 'm_live');
  assert.equal(liteUpload(read({ matches: [], live: live({}) })).live?.id, 'm_live');
  assert.equal(liteUpload(snapshot).matches.length, 1);
  assert.deepEqual(liteUpload(cloud).matches, []);
  assert.equal(liteUpload(cloud).live, null);
  assert.equal(liteUpload(read({ matches: [], live: null, removed: [{ id: 'm_gone', recordedAt: '2026-10-28T09:00:00.000Z' }] })).removed[0]?.id, 'm_gone');
  assert.equal(cloudMatches(cloudRoster, []).matches.length, 0);
  // An unplayed club fixture has no place in Lite, which holds one live slot and finished games.
  assert.deepEqual(cloudMatches(cloudRoster, [{ ...server, id: GOAL_EVENT, status: 'scheduled', match_players: [], match_events: [] }]).matches, []);
  assert.equal(cloudMatches(cloudRoster, [{ ...server, status: 'in_progress' }]).live?.id, matchUuid);
  assert.equal(cloudMatches(cloudRoster, [{ ...server, deleted_at: '2026-10-28T09:00:00.000Z' }]).removed[0]?.recordedAt, '2026-10-28T09:00:00.000Z');
  assert.equal(cloudMatches(cloudRoster, [{ ...server, formation: null, ended_at: null }]).matches[0]?.formation, '');
  assert.throws(() => cloudMatches(cloudRoster, [{ ...server, team_id: TEAM.replace('cf00', 'df00') }]), /foreign cloud team/);
  assert.throws(() => cloudMatches(cloudRoster, [{ ...server, match_players: [{ id: LINEUP_ONE, player_id: sam.id, listed_as: 'starter', recorded_seconds: 0 },
    { id: GOAL_EVENT, player_id: sam.id, listed_as: 'bench', recorded_seconds: 0 }] }]), /duplicate cloud lineup player/);
  assert.throws(() => cloudMatches(cloudRoster, [{ ...server, match_players: [{ id: LINEUP_ONE, player_id: sam.id, listed_as: 'substitute', recorded_seconds: 0 }] }]), /cloud lineup role/);
  assert.throws(() => cloudMatches(cloudRoster, [{ ...server, status: 'forfeited' }]), /status/);
  assert.throws(() => cloudMatches(cloudRoster, [{ ...server, team_format: 'seven' }]), /format/);
  assert.throws(() => cloudMatches(cloudRoster, [{ ...server, match_events: [{ ...server.match_events[0]!, kind: 'penalty' }] }]), /cloud event kind/);
  assert.throws(() => cloudMatches(cloudRoster, [{ ...server, match_events: [{ ...server.match_events[0]!, kind: 'assist', link_event_id: null }] }]), /cloud event references/);
  assert.throws(() => cloudMatches(cloudRoster, [{ ...server, match_events: [{ id: GOAL_EVENT, kind: 'substitution', actor_player_id: sam.id,
    second_player_id: sam.id, link_event_id: null, period_label: '1st Half', match_time_seconds: 600, recorded_at: '2026-10-27T10:10:00.000Z', deleted_at: null }] }]), /cloud event references/);
  // A soft-deleted goal cannot keep a live assist pointing at it.
  const assistRow = { id: GOAL_EVENT, kind: 'assist', actor_player_id: alex.id, second_player_id: null, link_event_id: goalUuid,
    period_label: '1st Half', match_time_seconds: 600, recorded_at: '2026-10-27T10:10:00.000Z', deleted_at: null };
  assert.throws(() => cloudMatches(cloudRoster, [{ ...server, match_events: [{ ...server.match_events[0]!, deleted_at: '2026-10-28T09:00:00.000Z' }, assistRow] }]), /no live goal/);

  // Merging the raw file against the copy the club serves back would key one match twice - by Lite
  // id and by server UUID - which is why the provider canonicalises before it merges.
  assert.equal(mergeLiteMatches(snapshot, cloud).matches.length, 2);
  const joined = mergeLiteMatches(canonical, cloud);
  assert.equal(joined.matches.length, 1);
  assert.equal(joined.matches[0]?.id, 'm_one');
  assert.equal(joined.matches[0]?.proId, matchUuid);
  assert.equal(joined.matches[0]?.lineupIds?.p_one, LINEUP_ONE);
  assert.equal(joined.matches[0]?.events.find(event => event.proId === goalUuid)?.id, 'e_goal');
  const rejoined = matchInputs(roster, liteAuthored(joined));
  assert.equal(rejoined.filter(input => input.table === 'matches').length, 1);
  assert.equal(rejoined.find(input => input.payload.player_id === sam.id && input.table === 'match_players')?.rowId, LINEUP_ONE);
  const fresher = mergeLiteMatches(read({ matches: [{ ...canonicalMatch, recordedAt: '2026-10-28T10:00:00.000Z', opponent: 'Rivals Rescheduled' }] }), cloud);
  assert.equal(fresher.matches[0]?.opponent, 'Rivals Rescheduled');
  assert.equal(fresher.matches[0]?.id, 'm_one');
  const gone = mergeLiteMatches(canonical, { ...cloud, removed: [{ id: matchUuid, proId: matchUuid, recordedAt: '2026-10-28T12:00:00.000Z' }] });
  assert.equal(gone.matches.length, 0);
  // The tombstone keeps this device's identity so Lite can retire its own copy.
  assert.equal(gone.removed[0]?.id, 'm_one');
  assert.equal(gone.removed[0]?.proId, matchUuid);
  const staleDelete = mergeLiteMatches(canonical, { ...cloud, removed: [{ id: matchUuid, proId: matchUuid, recordedAt: '2026-10-27T10:00:00.000Z' }] });
  assert.equal(staleDelete.matches.length, 1);
  assert.equal(staleDelete.removed.length, 0);
  assert.throws(() => mergeLiteMatches({ ...canonical, live: live({}) as unknown as LiteMatchRecord }, { ...cloud, live: live({ id: 'm_other', proId: undefined }) as unknown as LiteMatchRecord }), /single Lite live slot/);

  assert.equal(sharedMatchLog(roster, snapshot, sam.id).length, 1);
  assert.equal(sharedMatchLog(roster, snapshot, sam.id)[0]?.matchId, matchUuid);
  assert.equal(sharedMatchLog(roster, snapshot, sam.id)[0]?.playedSeconds, 2400);
  assert.equal(sharedMatchLog(roster, snapshot, sam.id)[0]?.teamSeconds, 3000);
  assert.equal(sharedMatchLog(roster, snapshot, sam.id)[0]?.listedAs, 'starter');
  assert.equal(sharedMatchLog(roster, snapshot, sam.id)[0]?.opponentName, 'Rivals FC');
  assert.equal(sharedMatchLog(roster, snapshot, alex.id)[0]?.listedAs, 'bench');
  assert.equal(sharedMatchLog(roster, snapshot, alex.id)[0]?.playedSeconds, 600);
  assert.deepEqual(sharedMatchLog(roster, read({ matches: [{ ...finished, status: 'paused' }] }), sam.id), []);
  assert.deepEqual(sharedMatchLog(roster, read({ matches: [], live: live({}) }), sam.id), []);
  assert.equal(sharedMatchLog(roster, read({ matches: [{ ...finished, playerTimers: { p_one: 9999 } }] }), sam.id)[0]?.playedSeconds, 3000);
  assert.equal(sharedMatchLog(roster, read({ removed: [{ id: 'm_one', recordedAt: '2026-10-28T09:00:00.000Z' }] }), sam.id).length, 0);
  assert.equal(sharedMatchLog(roster, read({ removed: [{ id: 'm_one', recordedAt: '2026-10-27T10:00:00.000Z' }] }), sam.id).length, 1);
  assert.equal(sharedMatchLog(roster, snapshot, '00000000-0000-4000-8000-000000000000').length, 1);
  assert.equal(sharedMatchLog(roster, snapshot, '00000000-0000-4000-8000-000000000000')[0]?.listedAs, null);
  assert.equal(sharedMatchLog(roster, snapshot, '00000000-0000-4000-8000-000000000000')[0]?.playedSeconds, 0);

  assert.equal(matchesFingerprint(read({ revision: '2026-10-28T12:00:00.000Z' })), matchesFingerprint(snapshot));
  assert.equal(matchesFingerprint(parseLiteMatches(sortedKeys(value), roster)), matchesFingerprint(snapshot));
  assert.notEqual(matchesFingerprint(read({ matches: [{ ...finished, ourGoals: 4 }] })), matchesFingerprint(snapshot));
  const later = nextRevision(snapshot.revision);
  assert.ok(compareIso(later, snapshot.revision) > 0);
  assert.equal(parseLiteMatches({ ...value, revision: later }, roster).revision, later);
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(nextRevision(null)));
  console.log('all shared Lite match checks passed');
})();

function compareIso(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b);
}
