import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { useSyncQueue } from '../../../core/sync';
import { supabase } from '../../../core/supabaseClient';
import { cacheKey, readCache, writeCache } from '../attendance/cache';
import {
  formatTrainingDays,
  normalizeTrainingDays,
  parseTrainingSettings,
  pickNewerTrainingSettings,
  WEEKDAYS,
  type TrainingSettings,
  type TrainingWeekday,
} from '../attendance/trainingDays';

type Phase = 'loading' | 'ready' | 'failed';

/**
 * Training days live in public.team_settings, not on public.teams: a coach runs training but
 * teams_update_manager is manager-only, and widening it would also let a coach rename or
 * hand over the squad.
 *
 * The save path matches the rest of Pro: the phone writes to its outbox first and the screen
 * says so, because the setup screen is often used at a ground with no signal.
 */
export const SetupScreen: React.FC<{ onBack: () => void; onOpenAttendance: () => void }> = ({
  onBack,
  onOpenAttendance,
}) => {
  const { memberships, user, isStaff } = useAuth();
  const { queue } = useSyncQueue();
  const membership = memberships.find(m => m.role !== 'parent') ?? memberships[0] ?? null;
  const teamId = membership?.teamId ?? null;
  const userId = user?.id ?? null;
  const canEdit = teamId !== null && isStaff(teamId);

  const [days, setDays] = useState<TrainingWeekday[]>([]);
  const [saved, setSaved] = useState<TrainingSettings>({ days: [], recordedAt: null });
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const edited = useRef(false);

  const load = useCallback(async () => {
    if (!teamId || !userId) {
      setPhase('ready');
      return;
    }
    setPhase('loading');
    setError(null);
    setSavedNote(null);
    const key = cacheKey('training', userId, teamId);
    const cached = await readCache(key);
    const local = parseTrainingSettings(cached.raw);
    if (cached.warning) setNotice(cached.warning);
    if (local.recordedAt) {
      setSaved(local);
      if (!edited.current) setDays(local.days);
      setPhase('ready');
    }

    const { data, error: readError } = await supabase
      .from('team_settings')
      .select('training_days, recorded_at')
      .eq('id', teamId)
      .maybeSingle();

    if (readError) {
      // A cached copy is still workable; only a cold phone with no copy is a dead end.
      if (!local.recordedAt) {
        setError(`Training days could not be read from the club: ${readError.message}`);
        setPhase('failed');
        return;
      }
      setNotice(`Showing the training days saved on this phone. The club could not be reached: ${readError.message}`);
      setPhase('ready');
      return;
    }

    const winner = pickNewerTrainingSettings(local, parseTrainingSettings(data));
    setSaved(winner);
    if (!edited.current) setDays(winner.days);
    setPhase('ready');
    setError(null);

    const warning = await writeCache(key, {
      training_days: winner.days,
      recorded_at: winner.recordedAt,
    });
    if (warning) setNotice(warning);
  }, [teamId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = days.length !== saved.days.length || days.some((day, index) => day !== saved.days[index]);

  const toggle = (day: TrainingWeekday): void => {
    if (!canEdit) return;
    edited.current = true;
    setSavedNote(null);
    setDays(current =>
      current.includes(day) ? current.filter(item => item !== day) : normalizeTrainingDays([...current, day]),
    );
  };

  const save = async (): Promise<void> => {
    if (!teamId || !userId || !canEdit) return;
    setNotice(null);
    setSavedNote(null);
    const recordedAt = new Date().toISOString();
    const queued = queue.enqueue({
      table: 'team_settings',
      rowId: teamId,
      op: 'upsert',
      requiresRowId: null,
      recordedAt,
      payload: {
        training_days: days,
        recorded_at: recordedAt,
      },
    });
    if (!queued) {
      setNotice('Training days were not saved: the sync queue is not attached to an account. Sign in again, then retry.');
      return;
    }

    const next: TrainingSettings = { days, recordedAt };
    setSaved(next);
    edited.current = false;
    setSavedNote(
      days.length === 0
        ? 'Saved. This squad now has no training days.'
        : `Saved: ${formatTrainingDays(days)}. It syncs when the phone has signal.`,
    );
    const warning = await writeCache(cacheKey('training', userId, teamId), {
      training_days: days,
      recorded_at: recordedAt,
    });
    if (warning) setNotice(warning);
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={onBack}>
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Setup</Text>
          <Text style={styles.headerMeta}>{membership?.teamName ?? 'No squad yet'}</Text>
        </View>
      </View>

      {!membership ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No squad on this account</Text>
          <Text style={styles.meta}>Training days belong to a squad, and this account is not on one yet.</Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.label}>Training days</Text>
          <Text style={styles.meta}>
            Attendance is taken on these days. Pick every weekday this squad trains.
          </Text>

          <View style={styles.weekdayRow}>
            {WEEKDAYS.map(option => {
              const selected = days.includes(option.value);
              return (
                <Pressable
                  key={option.value}
                  onPress={() => toggle(option.value)}
                  disabled={!canEdit}
                  accessibilityRole="button"
                  accessibilityLabel={option.long}
                  accessibilityState={{ selected, disabled: !canEdit }}
                  style={[styles.weekday, selected && styles.weekdaySelected, !canEdit && styles.weekdayLocked]}
                >
                  <Text style={[styles.weekdayLabel, selected && styles.weekdayLabelSelected]}>{option.short}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.summary}>
            {days.length === 0
              ? 'No training days set. Attendance has no sessions to mark.'
              : `${days.length} session${days.length === 1 ? '' : 's'} a week: ${formatTrainingDays(days)}`}
          </Text>

          {canEdit ? (
            <Pressable
              onPress={() => void save()}
              disabled={!dirty}
              style={[styles.save, !dirty && styles.saveIdle]}
            >
              <Text style={[styles.saveLabel, !dirty && styles.saveLabelIdle]}>
                {dirty ? 'Save training days' : 'All saved'}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.readOnly}>Only a coach or manager can change training days.</Text>
          )}
        </View>
      )}

      {membership ? (
        <Pressable style={styles.secondary} onPress={onOpenAttendance}>
          <Text style={styles.secondaryLabel}>Take attendance</Text>
        </Pressable>
      ) : null}

      {phase === 'loading' ? <ActivityIndicator color="#facc15" /> : null}

      {savedNote ? <Text style={styles.saved}>{savedNote}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {phase === 'failed' ? (
        <View style={styles.card}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => void load()}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
};

const styles = {
  screen: { padding: 16, gap: 12, backgroundColor: '#0b0f17' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#1b1b22' },
  backLabel: { color: '#facc15', fontSize: 13, fontWeight: '700' },
  headerText: { flex: 1 },
  title: { color: '#e2e8f0', fontSize: 22, fontWeight: '800' },
  headerMeta: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  card: { padding: 14, borderRadius: 14, backgroundColor: '#1b1b22', gap: 10 },
  cardTitle: { color: '#e2e8f0', fontSize: 16, fontWeight: '800' },
  label: { color: '#94a3b8', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  meta: { color: '#cbd5e1', fontSize: 13, lineHeight: 19 },
  weekdayRow: { flexDirection: 'row', gap: 6 },
  weekday: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#334155',
  },
  weekdaySelected: { backgroundColor: '#facc15', borderColor: '#facc15' },
  weekdayLocked: { opacity: 0.6 },
  weekdayLabel: { color: '#cbd5e1', fontSize: 12, fontWeight: '800' },
  weekdayLabelSelected: { color: '#111115' },
  summary: { color: '#e2e8f0', fontSize: 14, fontWeight: '600' },
  readOnly: { color: '#facc15', fontSize: 13 },
  save: { paddingVertical: 12, borderRadius: 10, backgroundColor: '#facc15', alignItems: 'center' },
  saveIdle: { backgroundColor: '#263043' },
  saveLabel: { color: '#111115', fontSize: 15, fontWeight: '800' },
  saveLabelIdle: { color: '#94a3b8' },
  secondary: { padding: 12, borderRadius: 10, backgroundColor: '#1b1b22', alignItems: 'center' },
  secondaryLabel: { color: '#e2e8f0', fontSize: 15, fontWeight: '700' },
  saved: { color: '#86efac', fontSize: 13 },
  notice: { color: '#facc15', fontSize: 13, lineHeight: 19 },
  error: { color: '#f87171', fontSize: 13, lineHeight: 19 },
  retry: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#111827', alignSelf: 'flex-start' },
  retryLabel: { color: '#facc15', fontSize: 14, fontWeight: '700' },
} as const;
