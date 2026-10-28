import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { useSyncQueue } from '../../../core/sync';
import { supabase } from '../../../core/supabaseClient';
import { cacheKey, readCache, writeCache } from '../attendance/cache';
import { DEMO_USER_ID, previewTrainingSettings, savePreviewTraining } from '../../shared/demo';
import { useClubRoster } from '../../shared/ClubRosterProvider';
import { ci } from '../../shared/ci';
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
 * The training-day picker, shared by the Training tab and Settings so both edit the same
 * team_settings row through one load and one save path.
 */
export const TrainingDaysCard: React.FC = () => {
  const { user, isStaff } = useAuth();
  const { queue } = useSyncQueue();
  const { membership, local, preview, warning } = useClubRoster();
  const teamId = membership?.teamId ?? null;
  const installationId = local?.installationId ?? null;
  const userId = preview ? (installationId ? `lite-${installationId}` : DEMO_USER_ID) : user?.id ?? null;
  const canEdit = !(preview && warning) && (preview || (teamId !== null && isStaff(teamId)));

  const [days, setDays] = useState<TrainingWeekday[]>([]);
  const [saved, setSaved] = useState<TrainingSettings>({ days: [], recordedAt: null });
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const edited = useRef(false);
  const editRevision = useRef(0);
  const savedRef = useRef<TrainingSettings>({ days: [], recordedAt: null });
  const loadRequest = useRef(0);
  const scopeRef = useRef('');

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    const active = (): boolean => request === loadRequest.current;
    setError(null);
    setNotice(null);
    setSavedNote(null);
    if (preview) {
      const result = installationId && teamId && userId
        ? await readCache(cacheKey('training', userId, teamId))
        : null;
      if (!active()) return;
      const incoming = warning ? { days: [], recordedAt: null }
        : result ? parseTrainingSettings(result.raw)
          : local ? { days: [], recordedAt: null } : previewTrainingSettings();
      const current = pickNewerTrainingSettings(savedRef.current, incoming);
      savedRef.current = current;
      setSaved(current);
      if (!edited.current) setDays(current.days);
      if (result?.warning) setNotice(result.warning);
      setPhase('ready');
      return;
    }
    if (!teamId || !userId) {
      setPhase('ready');
      return;
    }
    setPhase('loading');
    const key = cacheKey('training', userId, teamId);
    const cached = await readCache(key);
    if (!active()) return;
    const cachedSettings = pickNewerTrainingSettings(savedRef.current, parseTrainingSettings(cached.raw));
    if (cached.warning) setNotice(cached.warning);
    if (cachedSettings.recordedAt) {
      savedRef.current = cachedSettings;
      setSaved(cachedSettings);
      if (!edited.current) setDays(cachedSettings.days);
      setPhase('ready');
    }

    const { data, error: readError } = await supabase
      .from('team_settings')
      .select('training_days, recorded_at')
      .eq('id', teamId)
      .maybeSingle();
    if (!active()) return;

    if (readError) {
      // A cached copy is still workable; only a cold phone with no copy is a dead end.
      if (!savedRef.current.recordedAt) {
        setError(`Training days could not be read from the club: ${readError.message}`);
        setPhase('failed');
        return;
      }
      setNotice(`Showing the training days saved on this phone. The club could not be reached: ${readError.message}`);
      setPhase('ready');
      return;
    }

    const winner = pickNewerTrainingSettings(savedRef.current, parseTrainingSettings(data));
    savedRef.current = winner;
    setSaved(winner);
    if (!edited.current) setDays(winner.days);
    setPhase('ready');
    setError(null);

    const cacheWarning = await writeCache(key, {
      training_days: winner.days,
      recorded_at: winner.recordedAt,
    });
    if (active() && cacheWarning) setNotice(cacheWarning);
  }, [preview, installationId, local, warning, teamId, userId]);

  useEffect(() => {
    const scope = `${preview}|${userId ?? ''}|${teamId ?? ''}`;
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      edited.current = false;
      savedRef.current = { days: [], recordedAt: null };
      setSaved(savedRef.current);
      setDays([]);
    }
    void load();
    return () => { loadRequest.current += 1; };
  }, [load, preview, userId, teamId]);

  const dirty = days.length !== saved.days.length || days.some((day, index) => day !== saved.days[index]);

  const toggle = (day: TrainingWeekday): void => {
    if (!canEdit) return;
    edited.current = true;
    editRevision.current += 1;
    setSavedNote(null);
    setDays(current =>
      current.includes(day) ? current.filter(item => item !== day) : normalizeTrainingDays([...current, day]),
    );
  };

  const save = async (): Promise<void> => {
    if (!teamId || !userId || !canEdit) return;
    setNotice(null);
    setSavedNote(null);
    if (preview) {
      const revision = editRevision.current;
      const next: TrainingSettings = { days, recordedAt: new Date().toISOString() };
      if (installationId) {
        const warning = await writeCache(cacheKey('training', userId, teamId), {
          training_days: next.days, recorded_at: next.recordedAt,
        });
        if (warning) { setNotice(warning); return; }
      } else {
        savePreviewTraining(next);
      }
      loadRequest.current += 1;
      savedRef.current = next;
      setSaved(next);
      setPhase('ready');
      if (editRevision.current === revision) edited.current = false;
      setSavedNote(installationId ? 'Saved on this device for Lite and Pro.' : 'Saved for this preview. Sign in to save training days for a real squad.');
      return;
    }
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

    loadRequest.current += 1;
    savedRef.current = { days, recordedAt };
    setSaved(savedRef.current);
    setPhase('ready');
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

  if (!membership) {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>Training days</Text>
        <Text style={warning ? styles.error : styles.meta}>{warning ?? 'Training days belong to a squad, and this account is not on one yet.'}</Text>
      </View>
    );
  }

  return (
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
        <Pressable onPress={() => void save()} disabled={!dirty} style={[styles.save, !dirty && styles.saveIdle]}>
          <Text style={[styles.saveLabel, !dirty && styles.saveLabelIdle]}>
            {dirty ? 'Save training days' : 'All saved'}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.readOnly}>Only a coach or manager can change training days.</Text>
      )}

      {warning ? <Text style={styles.error}>{warning}</Text> : null}
      {savedNote ? <Text style={styles.saved}>{savedNote}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {phase === 'loading' ? <ActivityIndicator color={ci.color.primary} /> : null}

      {phase === 'failed' ? (
        <>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => void load()}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
};

const styles = {
  card: { padding: 14, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 10 },
  label: { color: ci.color.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  meta: { color: ci.color.muted, fontSize: 13, lineHeight: 19 },
  weekdayRow: { flexDirection: 'row', gap: 6 },
  weekday: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: ci.radius.control,
    alignItems: 'center',
    backgroundColor: ci.color.background,
    borderWidth: 1,
    borderColor: ci.color.border,
  },
  weekdaySelected: { backgroundColor: ci.color.accent, borderColor: ci.color.accent },
  weekdayLocked: { opacity: 0.6 },
  weekdayLabel: { color: ci.color.muted, fontSize: 12, fontWeight: '800' },
  weekdayLabelSelected: { color: ci.color.onAccent },
  summary: { color: ci.color.text, fontSize: 14, fontWeight: '600' },
  readOnly: { color: ci.color.warning, fontSize: 13 },
  save: { paddingVertical: 12, borderRadius: ci.radius.control, backgroundColor: ci.color.primary, alignItems: 'center' },
  saveIdle: { backgroundColor: ci.color.disabledBg },
  saveLabel: { color: ci.color.onPrimary, fontSize: 15, fontWeight: '800' },
  saveLabelIdle: { color: ci.color.disabledText },
  saved: { color: ci.color.go, fontSize: 13 },
  notice: { color: ci.color.warning, fontSize: 13, lineHeight: 19 },
  error: { color: ci.color.danger, fontSize: 13, lineHeight: 19 },
  retry: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised, alignSelf: 'flex-start' },
  retryLabel: { color: ci.color.primary, fontSize: 14, fontWeight: '700' },
} as const;
