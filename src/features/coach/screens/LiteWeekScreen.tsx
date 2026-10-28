import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { supabase } from '../../../core/supabaseClient';
import { BrandLockup } from '../../shared/components/BrandLockup';
import { ci } from '../../shared/ci';
import { cacheKey, readCache, writeCache } from '../attendance/cache';
import {
  formatTrainingDays,
  parseTrainingSettings,
  pickNewerTrainingSettings,
  type TrainingSettings,
} from '../attendance/trainingDays';
import { formatWeekRange, mondayOf, sessionToday } from '../attendance/week';
import { DEMO_USER_ID, previewTrainingSettings } from '../../shared/demo';
import { useClubRoster } from '../../shared/ClubRosterProvider';

type Phase = 'loading' | 'ready';

/**
 * The Lite lens over the selected team: the shared roster and training days, whether the
 * team lives on this device or in the club. Pro adds tools without changing this data.
 */
export const LiteWeekScreen: React.FC<{
  onOpenSettings: () => void;
  onSwitchToPro: () => void;
}> = ({ onOpenSettings, onSwitchToPro }) => {
  const { user } = useAuth();
  const { membership, local, preview, previewPlayers, revision, warning } = useClubRoster();
  const teamId = membership?.teamId ?? null;
  const installationId = local?.installationId ?? null;
  const userId = preview ? (installationId ? `lite-${installationId}` : DEMO_USER_ID) : user?.id ?? null;

  const [phase, setPhase] = useState<Phase>('loading');
  const [training, setTraining] = useState<TrainingSettings>({ days: [], recordedAt: null });
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const visiblePlayers = previewPlayers;

  useEffect(() => {
    setTraining({ days: [], recordedAt: null });
    setError(null);
    if (preview) {
      if (!installationId || !teamId || !userId) {
        if (!warning && !local) setTraining(previewTrainingSettings());
        setPhase('ready');
        return;
      }
      let active = true;
      void readCache(cacheKey('training', userId, teamId)).then(result => {
        if (!active) return;
        setTraining(parseTrainingSettings(result.raw));
        setError(result.warning);
        setPhase('ready');
      });
      return () => { active = false; };
    }
    if (!teamId || !userId) {
      setPhase('ready');
      return;
    }
    setPhase('loading');
    let active = true;
    const trainingKey = cacheKey('training', userId, teamId);

    void (async () => {
      const trainingRead = await readCache(trainingKey);
      if (!active) return;

      const notes: string[] = [];
      if (trainingRead.warning) notes.push(trainingRead.warning);

      let localTraining = parseTrainingSettings(trainingRead.raw);
      setTraining(localTraining);
      setPhase('ready');

      const trainingResult = await supabase.from('team_settings')
        .select('training_days, recorded_at').eq('id', teamId).maybeSingle();
      if (!active) return;

      const failures: string[] = [];
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
  }, [preview, installationId, local, revision, warning, teamId, userId, reloadKey]);

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
        <BrandLockup size={24} onPress={onSwitchToPro} accessibilityLabel="Switch to Clubstride Pro" />
        <Pressable style={styles.headerAction} onPress={onOpenSettings}>
          <Text style={styles.headerActionLabel}>Settings</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>Lite view</Text>
      <Text style={styles.subtitle}>One app, the same selected team and data. Pro adds coaching tools.</Text>

      {warning ? <Text style={styles.error}>{warning}</Text> : null}

      {!membership && !warning ? (
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
            {roleLabel} · {visiblePlayers.length === 1 ? '1 player' : `${visiblePlayers.length} players`}
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

      {visiblePlayers.length > 0 ? (
        <View style={styles.list}>
          {visiblePlayers.map(player => (
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
