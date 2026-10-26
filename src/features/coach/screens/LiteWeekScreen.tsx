import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { supabase } from '../../../core/supabaseClient';
import { BrandLockup } from '../../shared/components/BrandLockup';
import { ci } from '../../shared/ci';
import { cacheKey, readCache, writeCache } from '../attendance/cache';
import { parseSquadRows, type SquadPlayerRow } from '../attendance/squad';
import {
  formatTrainingDays,
  parseTrainingSettings,
  pickNewerTrainingSettings,
  type TrainingSettings,
} from '../attendance/trainingDays';
import { formatWeekRange, mondayOf, sessionToday } from '../attendance/week';

type Phase = 'loading' | 'ready';

/**
 * The Lite lens over the same account: who is in the squad and when they train, with no Pro
 * screens and no writes. Lite's match-day tools live in the Lite app, so editing here would
 * be a second, divergent implementation of the same session.
 */
export const LiteWeekScreen: React.FC<{
  onOpenSettings: () => void;
  onSwitchToPro: () => void;
}> = ({ onOpenSettings, onSwitchToPro }) => {
  const { memberships, user } = useAuth();
  const membership = memberships.find(m => m.role !== 'parent') ?? memberships[0] ?? null;
  const teamId = membership?.teamId ?? null;
  const userId = user?.id ?? null;

  const [phase, setPhase] = useState<Phase>('loading');
  const [players, setPlayers] = useState<SquadPlayerRow[]>([]);
  const [training, setTraining] = useState<TrainingSettings>({ days: [], recordedAt: null });
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!teamId || !userId) {
      setPhase('ready');
      return;
    }
    let active = true;
    const squadKey = cacheKey('squad', userId, teamId);
    const trainingKey = cacheKey('training', userId, teamId);

    void (async () => {
      const [squadRead, trainingRead] = await Promise.all([readCache(squadKey), readCache(trainingKey)]);
      if (!active) return;

      const notes: string[] = [];
      if (squadRead.warning) notes.push(squadRead.warning);
      if (trainingRead.warning) notes.push(trainingRead.warning);

      const cachedSquad = parseSquadRows(squadRead.raw);
      let localTraining = parseTrainingSettings(trainingRead.raw);
      setPlayers(cachedSquad.players);
      setTraining(localTraining);
      setPhase('ready');
      if (cachedSquad.dropped > 0) notes.push(`${cachedSquad.dropped} saved squad row(s) could not be read.`);

      const [squadResult, trainingResult] = await Promise.all([
        supabase
          .from('players')
          .select('id, full_name, shirt_number, position_tag, available')
          .eq('team_id', teamId)
          .is('deleted_at', null)
          .order('shirt_number', { ascending: true }),
        supabase.from('team_settings').select('training_days, recorded_at').eq('id', teamId).maybeSingle(),
      ]);
      if (!active) return;

      const failures: string[] = [];
      if (squadResult.error) {
        failures.push(`Squad: ${squadResult.error.message}`);
      } else {
        const fresh = parseSquadRows(squadResult.data);
        setPlayers(fresh.players);
        if (fresh.dropped > 0) failures.push(`${fresh.dropped} squad row(s) came back unreadable.`);
        const warning = await writeCache(squadKey, fresh.players);
        if (warning) failures.push(warning);
      }

      if (trainingResult.error) {
        failures.push(
          localTraining.days.length > 0
            ? `Training days: showing the copy saved on this phone. The club copy could not be read: ${trainingResult.error.message}`
            : `Training days: ${trainingResult.error.message}`,
        );
      } else {
        localTraining = pickNewerTrainingSettings(localTraining, parseTrainingSettings(trainingResult.data));
        setTraining(localTraining);
        const warning = await writeCache(trainingKey, {
          training_days: localTraining.days,
          recorded_at: localTraining.recordedAt,
        });
        if (warning) failures.push(warning);
      }

      if (active) setError([...notes, ...failures].join(' ') || null);
    })();

    return () => {
      active = false;
    };
  }, [teamId, userId, reloadKey]);

  const roleLabel = membership
    ? membership.role === 'manager'
      ? 'Manager'
      : membership.role === 'coach'
        ? 'Coach'
        : 'Parent'
    : null;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <BrandLockup size={24} />
        <Pressable style={styles.headerAction} onPress={onOpenSettings}>
          <Text style={styles.headerActionLabel}>Settings</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>Lite view</Text>
      <Text style={styles.subtitle}>Squad and training days. The match-day tools live in Clubstride Lite.</Text>

      {!membership ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No squad yet</Text>
          <Text style={styles.meta}>
            This account is not on a team. A manager adds coaches and staff from the club side, or switch to
            Pro to found a squad.
          </Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.warningCard}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => setReloadKey(key => key + 1)}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {membership && phase === 'loading' ? <ActivityIndicator color={ci.color.primary} /> : null}

      {membership ? (
        <View style={styles.card}>
          <Text style={styles.label}>Team</Text>
          <Text style={styles.teamName}>{membership.teamName}</Text>
          <Text style={styles.meta}>
            {roleLabel} · {players.length === 1 ? '1 player' : `${players.length} players`}
          </Text>
        </View>
      ) : null}

      {membership ? (
        <View style={styles.card}>
          <Text style={styles.label}>Training week · {formatWeekRange(mondayOf(sessionToday()))}</Text>
          <Text style={styles.value}>{formatTrainingDays(training.days)}</Text>
          <Text style={styles.meta}>
            {training.days.length === 0
              ? 'Switch to Pro and open Training setup to choose the days this squad trains.'
              : 'Attendance is taken from the Pro side.'}
          </Text>
        </View>
      ) : null}

      {players.length > 0 ? (
        <View style={styles.list}>
          {players.map(player => (
            <View key={player.id} style={styles.playerRow}>
              <View style={styles.badge}>
                <Text style={styles.badgeLabel}>#{player.shirt_number}</Text>
              </View>
              <View style={styles.playerText}>
                <Text style={styles.playerName}>{player.full_name}</Text>
                {player.position_tag ? <Text style={styles.meta}>{player.position_tag}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {membership ? (
        <Pressable style={styles.primary} onPress={onSwitchToPro}>
          <Text style={styles.primaryLabel}>Switch to Pro</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
};

const styles = {
  screen: { padding: 16, gap: 12, backgroundColor: ci.color.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerAction: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised },
  headerActionLabel: { color: ci.color.text, fontSize: 13, fontWeight: '700' },
  title: { color: ci.color.text, fontSize: 22, fontWeight: '800' },
  subtitle: { color: ci.color.muted, fontSize: 13, lineHeight: 19 },
  card: { padding: 14, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 4 },
  label: { color: ci.color.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  value: { color: ci.color.text, fontSize: 15, fontWeight: '600' },
  teamName: { color: ci.color.text, fontSize: 17, fontWeight: '800' },
  cardTitle: { color: ci.color.text, fontSize: 16, fontWeight: '800' },
  meta: { color: ci.color.muted, fontSize: 13 },
  list: { borderRadius: ci.radius.card, backgroundColor: ci.color.surface, overflow: 'hidden' },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: ci.color.border },
  badge: { minWidth: 38, paddingVertical: 3, paddingHorizontal: 6, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised, alignItems: 'center' },
  badgeLabel: { color: ci.color.primary, fontSize: 12, fontWeight: '800' },
  playerText: { flex: 1 },
  playerName: { color: ci.color.text, fontSize: 15, fontWeight: '600' },
  warningCard: { padding: 12, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 8 },
  error: { color: ci.color.danger, fontSize: 13, lineHeight: 19 },
  retry: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised },
  retryLabel: { color: ci.color.primary, fontSize: 13, fontWeight: '700' },
  primary: { padding: 12, borderRadius: ci.radius.control, backgroundColor: ci.color.primary, alignItems: 'center' },
  primaryLabel: { color: ci.color.onPrimary, fontSize: 15, fontWeight: '800' },
} as const;
