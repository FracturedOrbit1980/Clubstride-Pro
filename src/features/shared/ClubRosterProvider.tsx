import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useAuth, type Membership } from '../../core/context/AuthContext';
import { mintRowId, stableRowId, useSyncQueue } from '../../core/sync';
import { supabase } from '../../core/supabaseClient';
import { parseSquadRows, type SquadPlayerRow } from '../coach/attendance/squad';
import { cacheKey, readCache, writeCache } from '../coach/attendance/cache';
import { indexAttendance, mergeAttendance, parseAttendanceRows } from '../coach/attendance/attendance';
import { parseTrainingSettings, pickNewerTrainingSettings } from '../coach/attendance/trainingDays';
import { parseAssessmentRow, pickNewerAssessment, queueAssessment, toAssessmentRow } from '../coach/player/assessmentSync';
import { drillPayload, parseDrillRows, toDrillRow } from '../coach/drills/drills';
import { DEMO_MEMBERSHIP, DEMO_PLAYERS } from './demo';
import {
  LITE_MATCHES_PREFIX, canonicalMatches, cloudMatches, liteMatchesKey, liteUpload, matchInputs, matchesFingerprint,
  mergeLiteMatches, nextRevision, parseLiteMatches, sharedMatchLog, type LiteMatches,
} from './liteMatches';
import type { PlayerMatchEntry } from '../coach/player/minutes';
import { LITE_ROSTER_KEY, clubRoster, connectionKey, connectLiteRoster, localMembership, mergeInitialRoster,
  parseLiteConnection, parseLiteRoster, planLiteSync, rosterSnapshot, validSharedText, type LiteConnection, type LiteRoster } from './liteRoster';

interface ClubRosterValue {
  membership: Membership | null;
  local: LiteRoster | null;
  preview: boolean;
  previewPlayers: SquadPlayerRow[];
  revision: string;
  warning: string | null;
  loading: boolean;
  teams: { id: string; name: string }[];
  selectedTeam: string;
  selectTeam: (id: string) => void;
  reload: () => void;
  savePlayer: (player: SquadPlayerRow) => void;
  deletePlayer: (id: string) => void;
  /** Completed Lite and club matches for one player, read from the shared team history. */
  matchLog: (playerId: string) => PlayerMatchEntry[];
  /** Changes only when the shared history changes, so a screen can depend on it safely. */
  matchRevision: string;
}

const Context = createContext<ClubRosterValue | null>(null);
const DEVICE_ROSTER_KEY = 'cs.club.device-roster.v1';
const activeKey = (userId: string) => `cs.club.active-team.v1.${userId}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const matchesScope = (roster: LiteRoster) => `${roster.installationId}:${roster.teamId}`;
const emptyMatches = (roster: LiteRoster): LiteMatches => ({ version: 1, installationId: roster.installationId,
  teamId: roster.teamId, revision: roster.revision, matches: [], live: null, removed: [] });
// Lite has no fixture list, so an unplayed club match has nowhere to land; everything else the
// profile reads is fetched in one joined pass.
const MATCH_SELECT = 'id, team_id, title, opponent_name, match_date, team_format, formation, status, period_label, ' +
  'duration_seconds, team_goals, opponent_goals, ended_at, recorded_at, deleted_at, ' +
  'match_players(id, player_id, listed_as, recorded_seconds), ' +
  'match_events(id, kind, actor_player_id, second_player_id, link_event_id, period_label, match_time_seconds, recorded_at, deleted_at)';

export const ClubRosterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { preview: signedOut, user, memberships, status } = useAuth();
  const { queue, attached, pending, blocked, flushing } = useSyncQueue();
  const [roster, setRoster] = useState<LiteRoster | null>(null);
  const [deviceRoster, setDeviceRoster] = useState<LiteRoster | null>(null);
  const [localTeams, setLocalTeams] = useState<LiteRoster[]>([]);
  const [choice, setChoice] = useState('');
  const [warning, setWarning] = useState<string | null>(null);
  const [sourceWarning, setSourceWarning] = useState<string | null>(null);
  const [matchWarning, setMatchWarning] = useState<string | null>(null);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [sharedMatches, setSharedMatches] = useState<{ scope: string; snapshot: LiteMatches } | null>(null);
  const [cloud, setCloud] = useState<{ scope: string; players: SquadPlayerRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const scope = useRef('');
  const account = useRef<string | null>(null);

  const refresh = useCallback(() => {
    if (Platform.OS !== 'web') return;
    try {
      const raw = window.localStorage.getItem(LITE_ROSTER_KEY);
      const next = raw === null ? null : parseLiteRoster(JSON.parse(raw));
      setRoster(current => current && next && JSON.stringify(current) === JSON.stringify(next) ? current : next);
      if (next && !next.cloudTeamId && !next.ownerId) {
        window.localStorage.setItem(DEVICE_ROSTER_KEY, JSON.stringify(rosterSnapshot(next, next.players, next.revision)));
        setDeviceRoster(next);
        setChoice(`local:${next.teamId}`);
      } else {
        const stored = window.localStorage.getItem(DEVICE_ROSTER_KEY);
        setDeviceRoster(stored ? parseLiteRoster(JSON.parse(stored)) : null);
        if (next?.cloudTeamId) setChoice(`club:${next.cloudTeamId}`);
      }
      const saved = JSON.parse(window.localStorage.getItem('Clubstride Mobile_teams') ?? '[]') as unknown;
      const teams: LiteRoster[] = [];
      if (Array.isArray(saved) && next) for (const value of saved) {
        if (!value || typeof value !== 'object') continue;
        const team = value as Record<string, unknown>;
        if (team.cloudTeamId || typeof team.id !== 'string' || typeof team.name !== 'string' || !Array.isArray(team.squad)) continue;
        teams.push(parseLiteRoster({ version: 1, installationId: next.installationId, teamId: team.id,
          teamName: team.name, revision: next.revision, players: team.squad }));
      }
      setLocalTeams(teams);
      setSourceWarning(null);
      const scope = next ? matchesScope(next) : '';
      const stored = next === null ? null : window.localStorage.getItem(liteMatchesKey(next));
      try {
        const parsed = next === null || stored === null ? null : parseLiteMatches(JSON.parse(stored), next);
        setSharedMatches(current => {
          if (parsed === null) return null;
          return current && current.scope === scope && current.snapshot.revision === parsed.revision ? current : { scope, snapshot: parsed };
        });
        setMatchWarning(null);
      } catch (error) {
        setSharedMatches(null);
        setMatchWarning(errorText(error));
      }
    } catch (error) {
      setRoster(null);
      setSharedMatches(null);
      setSourceWarning(errorText(error));
    }
  }, []);

  const publish = useCallback((next: LiteRoster, expected: string | null): LiteRoster => {
    if (Platform.OS !== 'web') return next;
    if (window.localStorage.getItem(LITE_ROSTER_KEY) !== expected) throw new Error('The squad changed during the update. Retry using its latest data.');
    const body = rosterSnapshot(next, next.players, next.revision);
    const previous = expected ? parseLiteRoster(JSON.parse(expected)) : null;
    if (previous && JSON.stringify(rosterSnapshot(previous, previous.players, '')) === JSON.stringify(rosterSnapshot(next, next.players, ''))) return previous;
    body.revision = new Date(Math.max(Date.now(), Date.parse(next.revision) + 1)).toISOString();
    window.localStorage.setItem(LITE_ROSTER_KEY, JSON.stringify(body));
    window.dispatchEvent(new Event('cs-lite-roster-change'));
    return parseLiteRoster(body);
  }, []);

  /**
   * Lite owns this team's history file, so a club read is written back the same way the roster
   * is: compare the exact string that was read, skip identical content, and only then advance the
   * revision. Without the content check the two apps would keep republishing one another.
   */
  const publishMatches = useCallback((source: LiteRoster, next: LiteMatches, expected: string | null): LiteMatches => {
    if (Platform.OS !== 'web') return next;
    const key = liteMatchesKey(source);
    if (window.localStorage.getItem(key) !== expected) throw new Error('The match history changed during the update. Retry using its latest data.');
    const previous = expected === null ? null : parseLiteMatches(JSON.parse(expected), source);
    const clean = parseLiteMatches({ ...next, revision: nextRevision(previous?.revision ?? next.revision) }, source);
    if (previous && matchesFingerprint(previous) === matchesFingerprint(clean)) return previous;
    window.localStorage.setItem(key, JSON.stringify(clean));
    window.dispatchEvent(new Event('cs-lite-matches-change'));
    return clean;
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    refresh();
    const changed = (event: StorageEvent) => {
      if (event.key === LITE_ROSTER_KEY || event.key === 'Clubstride Mobile_teams' || event.key === null ||
          event.key?.startsWith(LITE_MATCHES_PREFIX)) refresh();
    };
    window.addEventListener('storage', changed);
    window.addEventListener('cs-lite-roster-change', refresh);
    window.addEventListener('cs-lite-matches-change', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', changed);
      window.removeEventListener('cs-lite-roster-change', refresh);
      window.removeEventListener('cs-lite-matches-change', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (Platform.OS !== 'web' || account.current === (user?.id ?? null)) return;
    account.current = user?.id ?? null;
    setCloud(null);
    setWarning(null);
    if (user) {
      const saved = window.localStorage.getItem(activeKey(user.id));
      if (saved) setChoice(saved);
    } else {
      try {
        const expected = window.localStorage.getItem(LITE_ROSTER_KEY);
        const current = expected ? parseLiteRoster(JSON.parse(expected)) : null;
        const fallback = deviceRoster ?? parseLiteRoster({ version: 1, installationId: current?.installationId ?? mintRowId(),
          teamId: 'lite-default', teamName: 'Your team', players: [], revision: new Date().toISOString() });
        publish(fallback, expected);
      } catch (error) { setWarning(errorText(error)); }
    }
  }, [deviceRoster, publish, user]);

  const matching = roster && !roster.cloudTeamId && !roster.ownerId
    ? memberships.filter(m => m.role !== 'parent' && m.teamName === roster.teamName) : [];
  const parentOnly = !!user && memberships.length > 0 && memberships.every(m => m.role === 'parent');
  const selectedClub = !signedOut && status === 'ready'
    ? memberships.find(m => choice === `club:${m.teamId}`) ?? (matching.length === 1 ? matching[0] : null)
      ?? (parentOnly || (!roster && !sourceWarning) ? memberships.find(m => m.role !== 'parent') ?? memberships[0] : null) ?? null : null;
  const local = selectedClub ? null : roster && !roster.cloudTeamId && !roster.ownerId ? roster : null;
  const membership = selectedClub ?? (local ? localMembership(local) : signedOut && !roster && !sourceWarning ? DEMO_MEMBERSHIP : null);
  const currentScope = selectedClub && user ? `${user.id}:${selectedClub.teamId}:${selectedClub.role}` : '';
  scope.current = currentScope;
  const dataPreview = !!local || signedOut;
  const players = selectedClub
    ? cloud?.scope === currentScope ? cloud.players
      : roster?.cloudTeamId === selectedClub.teamId && roster.ownerId === user?.id && roster.readOnly === (selectedClub.role === 'parent') ? roster.players : []
    : sourceWarning ? [] : local?.players ?? (signedOut && !roster ? DEMO_PLAYERS : []);

  const migrateRecords = async (source: LiteRoster, connection: LiteConnection, owner: string): Promise<void> => {
    const marker = `${connectionKey(owner, source)}.records`;
    if (window.localStorage.getItem(marker)) return;
    const localTeamId = localMembership({ ...source, cloudTeamId: null }).teamId;
    const localOwner = `lite-${source.installationId}`;
    const authorized = () => scope.current === `${owner}:${connection.teamId}:coach` || scope.current === `${owner}:${connection.teamId}:manager`;
    const [trainingRead, attendanceRead, drillsRead, ...assessments] = await Promise.all([
      readCache(cacheKey('training', localOwner, localTeamId)),
      readCache(cacheKey('attendance', localOwner, localTeamId)),
      readCache(cacheKey('drills', localOwner, localTeamId)),
      ...source.players.map(player => readCache(cacheKey('assessment', localOwner, `${localTeamId}.${player.id}`))),
    ]);
    if (!authorized()) return;
    for (const result of [trainingRead, attendanceRead, drillsRead, ...assessments]) if (result.warning) throw new Error(result.warning);
    const trainingKey = cacheKey('training', owner, connection.teamId);
    const trainingCache = await readCache(trainingKey);
    if (!authorized()) return;
    if (trainingCache.warning) throw new Error(trainingCache.warning);
    const training = pickNewerTrainingSettings(parseTrainingSettings(trainingCache.raw), parseTrainingSettings(trainingRead.raw));
    if (training.recordedAt && trainingRead.raw !== null) {
      const payload = { training_days: training.days, recorded_at: training.recordedAt };
      if (!queue.enqueue({ table: 'team_settings', rowId: connection.teamId, op: 'upsert', requiresRowId: null,
        recordedAt: training.recordedAt, payload })) throw new Error('Training days were not queued.');
      const warning = await writeCache(trainingKey, payload);
      if (warning) throw new Error(warning);
    }
    const attendance = parseAttendanceRows(attendanceRead.raw);
    if (attendance.dropped) throw new Error('Saved attendance is unreadable. It has not been discarded.');
    const rows = attendance.rows.flatMap(row => {
      const playerId = connection.idMap[row.player_id];
      return playerId ? [{ ...row, id: stableRowId('attendance', playerId, row.session_date, 'practice'), player_id: playerId }] : [];
    });
    const attendanceKey = cacheKey('attendance', owner, connection.teamId);
    const attendanceCache = await readCache(attendanceKey);
    if (!authorized()) return;
    if (attendanceCache.warning) throw new Error(attendanceCache.warning);
    const cachedAttendance = parseAttendanceRows(attendanceCache.raw);
    if (cachedAttendance.dropped) throw new Error('The club attendance cache is unreadable. It has been retained.');
    const merged = mergeAttendance(indexAttendance(cachedAttendance.rows), rows);
    for (const incoming of rows) {
      const row = merged[`${incoming.player_id}|${incoming.session_date}`]!;
      if (!queue.enqueue({ table: 'attendance', rowId: row.id, op: 'upsert', requiresRowId: row.player_id,
        recordedAt: row.recorded_at, payload: { team_id: connection.teamId, player_id: row.player_id, session_date: row.session_date,
          session_type: 'practice', status: row.status, recorded_at: row.recorded_at } })) throw new Error('Attendance was not queued.');
    }
    if (rows.length) {
      const warning = await writeCache(attendanceKey, Object.values(merged));
      if (warning) throw new Error(warning);
    }
    for (const result of assessments) {
      const assessment = parseAssessmentRow(result.raw);
      if (!assessment) { if (result.raw !== null) throw new Error('Saved player feedback is unreadable. It has been retained.'); continue; }
      const playerId = connection.idMap[assessment.playerId];
      if (!playerId) continue;
      const key = cacheKey('assessment', owner, `${connection.teamId}.${playerId}`);
      const cached = await readCache(key);
      if (!authorized()) return;
      if (cached.warning) throw new Error(cached.warning);
      const previous = parseAssessmentRow(cached.raw);
      const next = pickNewerAssessment(previous?.playerId === playerId ? previous : null, { ...assessment, playerId })!;
      if (!queueAssessment(queue, connection.teamId, next)) throw new Error('Player feedback was not queued.');
      const warning = await writeCache(key, toAssessmentRow(next, connection.teamId));
      if (warning) throw new Error(warning);
    }
    const drills = parseDrillRows(drillsRead.raw);
    if (drills.dropped) throw new Error('Saved drills are unreadable. They have been retained.');
    const drillsKey = cacheKey('drills', owner, connection.teamId);
    const cachedDrills = await readCache(drillsKey);
    if (!authorized()) return;
    if (cachedDrills.warning) throw new Error(cachedDrills.warning);
    const existingDrills = parseDrillRows(cachedDrills.raw);
    if (existingDrills.dropped) throw new Error('The club drills cache is unreadable. It has been retained.');
    const combined = new Map([...drills.drills, ...existingDrills.drills].map(drill => [drill.id, drill]));
    for (const local of drills.drills) {
      const drill = combined.get(local.id)!;
      if (!queue.enqueue({ table: 'drills', rowId: drill.id, op: 'upsert', requiresRowId: null, recordedAt: source.revision,
        payload: drillPayload(drill, connection.teamId) })) throw new Error('Drills were not queued.');
    }
    if (drills.drills.length) {
      const warning = await writeCache(drillsKey, [...combined.values()].map(toDrillRow));
      if (warning) throw new Error(warning);
    }
    if (authorized()) window.localStorage.setItem(marker, '1');
  };

  useEffect(() => {
    if (!selectedClub || !user || status !== 'ready' || !attached || sourceWarning) { setLoading(false); return; }
    const target = selectedClub;
    const owner = user.id;
    const requestScope = currentScope;
    let active = true;
    const valid = () => active && scope.current === requestScope;
    const load = async () => {
      setLoading(true);
      try {
        let expected = Platform.OS === 'web' ? window.localStorage.getItem(LITE_ROSTER_KEY) : null;
        const current = expected ? parseLiteRoster(JSON.parse(expected)) : null;
        const bound = current?.cloudTeamId === target.teamId && current.ownerId === owner;
        const adopting = current && !current.cloudTeamId && !current.ownerId && current.teamName === target.teamName && target.role !== 'parent';
        let source = bound || adopting ? current! : parseLiteRoster({ version: 1,
          installationId: current?.installationId ?? mintRowId(), teamId: `cloud-${target.teamId}`, teamName: target.teamName,
          revision: new Date().toISOString(), players: [] });
        if (Platform.OS === 'web' && target.role === 'parent' && (!bound || current?.readOnly !== true)) {
          source = publish(clubRoster(source, null, target, owner, [], source.revision), expected);
          expected = window.localStorage.getItem(LITE_ROSTER_KEY);
          setCloud({ scope: requestScope, players: [] });
        }
        const key = connectionKey(owner, source);
        let connection: LiteConnection | null = null;
        if (Platform.OS === 'web' && target.role !== 'parent') {
          const stored = window.localStorage.getItem(key);
          if (stored) {
            connection = parseLiteConnection(JSON.parse(stored), source);
            if (!connection || connection.teamId !== target.teamId) throw new Error('The saved squad sync state is unreadable. The squad has been retained.');
          }
        }
        if (connection && bound && target.role !== 'parent') {
          const plan = planLiteSync(source, connection);
          for (const input of plan.inputs) if (!queue.enqueue(input)) throw new Error('The squad update was not queued.');
          connection = plan.next;
          window.localStorage.setItem(key, JSON.stringify(connection));
          setCloud({ scope: requestScope, players: connection.players });
        }
        if (pending || blocked || flushing || queue.getSnapshot().pending || queue.getSnapshot().blocked || queue.getSnapshot().flushing) return;
        const result = await supabase.from('players').select('id, full_name, shirt_number, position_tag, available')
          .eq('team_id', target.teamId).is('deleted_at', null).order('shirt_number', { ascending: true });
        if (!valid() || (Platform.OS === 'web' && window.localStorage.getItem(LITE_ROSTER_KEY) !== expected)) return;
        if (result.error) throw new Error(result.error.message);
        const parsed = parseSquadRows(result.data);
        if (parsed.dropped) throw new Error('The squad could not be fully read. Its saved copy has not been replaced.');
        let nextPlayers = parsed.players;
        if (adopting && !connection) {
          connection = connectLiteRoster(source, target, parsed.players);
          const plan = planLiteSync(source, connection);
          nextPlayers = mergeInitialRoster(source, connection, parsed.players);
          for (const input of plan.inputs) if (!queue.enqueue(input)) throw new Error('The squad was not queued.');
          await migrateRecords(source, plan.next, owner);
          if (!valid() || window.localStorage.getItem(LITE_ROSTER_KEY) !== expected) return;
          connection = plan.next;
        }
        setCloud({ scope: requestScope, players: nextPlayers });
        if (Platform.OS === 'web') {
          source = clubRoster(source, connection, target, owner, nextPlayers, source.revision);
          const saved = publish(source, expected);
          if (target.role !== 'parent') window.localStorage.setItem(key, JSON.stringify({ installationId: saved.installationId,
            liteTeamId: saved.teamId, teamId: target.teamId, revision: saved.revision,
            idMap: Object.fromEntries(saved.players.map(player => [player.id, player.id])), players: saved.players } satisfies LiteConnection));
          window.localStorage.setItem(activeKey(owner), `club:${target.teamId}`);
        }
        if (valid()) setWarning(null);
        // One history, both ways: the matches this device recorded go up, and the club's list is
        // written back into the file Lite reads. A parent's scope never carries match data.
        if (Platform.OS === 'web' && target.role !== 'parent') {
          try {
            const historyKey = liteMatchesKey(source);
            const expectedHistory = window.localStorage.getItem(historyKey);
            // Cloud identities are attached before anything is compared: without this, the copy
            // the club serves back after an upload keys on its server UUID while this device still
            // keys on its Lite id, and one match becomes two.
            const localHistory = expectedHistory === null ? null
              : canonicalMatches(source, parseLiteMatches(JSON.parse(expectedHistory), source));
            if (localHistory) {
              const pushable = liteUpload(localHistory);
              const fingerprint = matchesFingerprint(pushable);
              const uploadedKey = `${historyKey}:uploaded`;
              // Draining the queue flips `pending`, which re-runs this effect. Without remembering
              // what was already sent, every poll would re-upload every Lite-authored row forever
              // and keep re-stamping its `updated_at` on the club side.
              if (window.localStorage.getItem(uploadedKey) !== fingerprint) {
                for (const input of matchInputs(source, pushable)) {
                  if (!queue.enqueue(input)) throw new Error('A match was not queued. It stays on this device.');
                }
                window.localStorage.setItem(uploadedKey, fingerprint);
              }
            }
            if (queue.getSnapshot().pending || queue.getSnapshot().blocked || queue.getSnapshot().flushing) return;
            const historyRead = await supabase.from('matches').select(MATCH_SELECT).eq('team_id', target.teamId);
            if (!valid() || window.localStorage.getItem(historyKey) !== expectedHistory) return;
            if (historyRead.error) throw new Error(historyRead.error.message);
            const merged = mergeLiteMatches(localHistory ?? emptyMatches(source), cloudMatches(source, historyRead.data));
            setSharedMatches({ scope: matchesScope(source), snapshot: publishMatches(source, merged, expectedHistory) });
            if (valid()) setHistoryWarning(null);
          } catch (error) {
            if (valid()) setHistoryWarning(`Match history: ${errorText(error)} The squad itself is unaffected.`);
          }
        }
      } catch (error) {
        if (valid()) setWarning(`Squad sync: ${errorText(error)} Changes remain on this device.`);
      } finally { if (valid()) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [attached, blocked, currentScope, flushing, pending, publish, reloadKey, roster, selectedClub, sourceWarning, status, user]);

  useEffect(() => {
    if (!currentScope || Platform.OS !== 'web') return;
    const reload = () => setReloadKey(key => key + 1);
    const channel = supabase.channel(`club-roster-${currentScope}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `team_id=eq.${selectedClub!.teamId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `team_id=eq.${selectedClub!.teamId}` }, reload)
      .subscribe();
    const timer = window.setInterval(reload, 30000);
    window.addEventListener('focus', reload);
    window.addEventListener('online', reload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', reload);
      window.removeEventListener('online', reload);
      void supabase.removeChannel(channel);
    };
  }, [currentScope, selectedClub]);

  const selectTeam = (id: string): void => {
    setWarning(null);
    if (id.startsWith('club:')) {
      if (!memberships.some(m => id === `club:${m.teamId}`)) return;
      setChoice(id);
      if (user && Platform.OS === 'web') window.localStorage.setItem(activeKey(user.id), id);
      return;
    }
    const selected = [deviceRoster, ...localTeams].find(team => team && id === `local:${team.teamId}`);
    if (parentOnly || !selected || Platform.OS !== 'web') return;
    try {
      publish(selected, window.localStorage.getItem(LITE_ROSTER_KEY));
      setChoice(id);
      if (user) window.localStorage.setItem(activeKey(user.id), id);
    } catch (error) { setWarning(errorText(error)); }
  };

  const updatePlayers = (nextPlayers: SquadPlayerRow[]): void => {
    if (!membership || membership.role === 'parent' || sourceWarning || !roster || Platform.OS !== 'web') throw new Error('This squad is read-only.');
    if (selectedClub && (roster.cloudTeamId !== selectedClub.teamId || roster.ownerId !== user?.id)) throw new Error('Wait for the selected squad to load.');
    const next = { ...roster, players: nextPlayers };
    const saved = publish(next, window.localStorage.getItem(LITE_ROSTER_KEY));
    if (selectedClub) setCloud({ scope: currentScope, players: saved.players });
  };
  const savePlayer = (player: SquadPlayerRow): void => {
    if (!validSharedText(player.full_name) || !validSharedText(player.position_tag ?? 'Unassigned', 40) ||
        !Number.isInteger(player.shirt_number) || player.shirt_number < 1 || player.shirt_number > 99) throw new Error('Enter a plain-text player name and shirt number from 1 to 99.');
    if (players.some(row => row.id !== player.id && row.shirt_number === player.shirt_number)) throw new Error('That shirt number is already in use.');
    updatePlayers([...players.filter(row => row.id !== player.id), { ...player, full_name: player.full_name.trim() }].sort((a, b) => a.shirt_number - b.shirt_number));
  };
  const teams = Array.from(new Map<string, { id: string; name: string }>([
    ...(parentOnly ? [] : [deviceRoster, ...localTeams]).flatMap(team => team ? [[`local:${team.teamId}`, { id: `local:${team.teamId}`, name: `${team.teamName} (device)` }] as const] : []),
    ...memberships.map(m => [`club:${m.teamId}`, { id: `club:${m.teamId}`, name: m.teamName }] as const),
  ]).values());

  /** One player's game time from the shared history, before any per-screen club read. */
  const matchLog = (playerId: string): PlayerMatchEntry[] => {
    if (!roster || roster.readOnly || sharedMatches === null || sharedMatches.scope !== matchesScope(roster)) return [];
    try { return sharedMatchLog(roster, sharedMatches.snapshot, playerId); } catch { return []; }
  };
  const matchRevision = roster && sharedMatches && sharedMatches.scope === matchesScope(roster) && !roster.readOnly
    ? `${sharedMatches.scope}:${sharedMatches.snapshot.revision}` : '';

  return <Context.Provider value={{ membership, local, preview: dataPreview, previewPlayers: players,
    revision: `${roster?.revision ?? ''}:${pending}:${blocked}`,
    warning: sourceWarning ?? warning ?? historyWarning ?? matchWarning, loading,
    teams, selectedTeam: selectedClub ? `club:${selectedClub.teamId}` : local ? `local:${local.teamId}` : '',
    selectTeam, reload: () => setReloadKey(key => key + 1), savePlayer, matchLog, matchRevision,
    deletePlayer: id => updatePlayers(players.filter(player => player.id !== id)) }}>{children}</Context.Provider>;
};

export const useClubRoster = (): ClubRosterValue => {
  const value = useContext(Context);
  if (!value) throw new Error('useClubRoster must be used within ClubRosterProvider');
  return value;
};
