import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { loadOutbox, mintRowId, outboxStorageKey, useSyncQueue } from '../../../core/sync';
import { supabase } from '../../../core/supabaseClient';
import { cacheKey, readCache, writeCache } from '../attendance/cache';
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
import {
  draftFromDrill,
  drillFromDraft,
  drillPayload,
  emptyDrillDraft,
  mergeDrills,
  parseDrillRow,
  parseDrillRows,
  sortDrills,
  summarizeDrill,
  toDrillRow,
  withoutDrills,
  type Drill,
  type DrillDraft,
} from '../drills/drills';
import { DrillEditorScreen } from './DrillEditorScreen';
import { DrillTimerScreen } from './DrillTimerScreen';

type Phase = 'loading' | 'ready' | 'failed';

type Pane = { kind: 'list' } | { kind: 'edit'; draft: DrillDraft } | { kind: 'run'; drill: Drill };

/**
 * Training days live in public.team_settings, not on public.teams: a coach runs training but
 * teams_update_manager is manager-only, and widening it would also let a coach rename or
 * hand over the squad.
 *
 * The save path matches the rest of Pro: the phone writes to its outbox first and the screen
 * says so, because the setup screen is often used at a ground with no signal.
 */
export const SetupScreen: React.FC<{ onOpenAttendance: () => void }> = ({ onOpenAttendance }) => {
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

  const [drills, setDrills] = useState<Drill[]>([]);
  const [drillsPhase, setDrillsPhase] = useState<Phase>('loading');
  const [drillsError, setDrillsError] = useState<string | null>(null);
  const [drillNotice, setDrillNotice] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>({ kind: 'list' });

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

  const persistDrills = async (next: Drill[]): Promise<string | null> => {
    if (!userId || !teamId) return 'Not signed in, so the drills were not saved on this phone.';
    return writeCache(cacheKey('drills', userId, teamId), next.map(toDrillRow));
  };

  /**
   * A drill queued on this phone must stay on the list until it reaches the club, or a coach
   * without signal would watch their new drill disappear on the next read. The outbox is the
   * authority for those rows, so it is merged over the server's copy.
   */
  const loadDrills = useCallback(async () => {
    if (!teamId || !userId) {
      setDrills([]);
      setDrillsPhase('ready');
      return;
    }
    setDrillsPhase('loading');
    setDrillsError(null);
    const key = cacheKey('drills', userId, teamId);
    const cached = await readCache(key);
    const local = parseDrillRows(cached.raw);
    if (cached.warning) setDrillNotice(cached.warning);
    if (cached.raw !== null) {
      setDrills(local.drills);
      setDrillsPhase('ready');
    }

    const outbox = await loadOutbox(outboxStorageKey(userId));
    if (outbox.warning) setDrillNotice(outbox.warning);
    const drillEntries = outbox.state.entries.filter(entry => entry.table === 'drills');
    const pending = drillEntries
      .filter(entry => entry.op === 'upsert')
      .map(entry =>
        parseDrillRow({
          id: entry.rowId,
          name: entry.payload.name,
          focus: entry.payload.focus,
          details: entry.payload.details,
        }),
      )
      .filter((drill): drill is Drill => drill !== null);
    const removed = new Set(drillEntries.filter(entry => entry.op !== 'upsert').map(entry => entry.rowId));

    const { data, error: readError } = await supabase
      .from('drills')
      .select('id, name, focus, details')
      .eq('team_id', teamId)
      .is('deleted_at', null)
      .order('name', { ascending: true });

    if (readError) {
      if (cached.raw === null && pending.length === 0) {
        setDrillsError(`Drills could not be read from the club: ${readError.message}`);
        setDrillsPhase('failed');
        return;
      }
      setDrills(mergeDrills(withoutDrills(local.drills, removed), pending));
      setDrillNotice(
        `Showing the drills saved on this phone. The club could not be reached: ${readError.message}`,
      );
      setDrillsPhase('ready');
      return;
    }

    const fresh = parseDrillRows(data);
    const merged = mergeDrills(withoutDrills(fresh.drills, removed), pending);
    setDrills(merged);
    setDrillsPhase('ready');
    if (fresh.dropped > 0) setDrillNotice(`${fresh.dropped} drill row(s) came back unreadable.`);
    const warning = await writeCache(key, merged.map(toDrillRow));
    if (warning) setDrillNotice(warning);
  }, [teamId, userId]);

  useEffect(() => {
    void loadDrills();
  }, [loadDrills]);

  const saveDrill = async (draft: DrillDraft): Promise<string | null> => {
    if (!teamId || !userId) return 'Drills belong to a squad, and this account is not on one yet.';
    if (!canEdit) return 'Only a coach or manager can save drills for this squad.';
    const id = draft.id ?? mintRowId();
    const drill = drillFromDraft(draft, id);
    const queued = queue.enqueue({
      table: 'drills',
      rowId: id,
      op: 'upsert',
      requiresRowId: null,
      recordedAt: new Date().toISOString(),
      payload: drillPayload(drill, teamId),
    });
    if (!queued) {
      return 'The drill was not saved: the sync queue is not attached to an account. Sign in again, then retry.';
    }
    const next = sortDrills(
      draft.id ? drills.map(item => (item.id === id ? drill : item)) : [...drills, drill],
    );
    setDrills(next);
    setPane({ kind: 'list' });
    setDrillNotice(null);
    const warning = await persistDrills(next);
    if (warning) setDrillNotice(warning);
    return null;
  };

  const deleteDrill = async (draft: DrillDraft): Promise<string | null> => {
    if (!draft.id) return null;
    const queued = queue.enqueue({
      table: 'drills',
      rowId: draft.id,
      op: 'tombstone',
      requiresRowId: null,
      recordedAt: new Date().toISOString(),
      payload: {},
    });
    if (!queued) {
      return 'The drill was not deleted: the sync queue is not attached to an account. Sign in again, then retry.';
    }
    const next = drills.filter(item => item.id !== draft.id);
    setDrills(next);
    setPane({ kind: 'list' });
    setDrillNotice(null);
    const warning = await persistDrills(next);
    if (warning) setDrillNotice(warning);
    return null;
  };

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

  if (pane.kind === 'run') {
    return <DrillTimerScreen drill={pane.drill} onBack={() => setPane({ kind: 'list' })} />;
  }

  if (pane.kind === 'edit') {
    const draft = pane.draft;
    return (
      <DrillEditorScreen
        draft={draft}
        teamName={membership?.teamName ?? null}
        onCancel={() => setPane({ kind: 'list' })}
        onSave={saveDrill}
        onDelete={() => deleteDrill(draft)}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Training</Text>
        <Text style={styles.headerMeta}>{membership?.teamName ?? 'No squad yet'}</Text>
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
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.label}>Drills</Text>
            {canEdit ? (
              <Pressable
                style={styles.headAction}
                onPress={() => setPane({ kind: 'edit', draft: emptyDrillDraft() })}
                accessibilityRole="button"
                accessibilityLabel="New drill"
              >
                <Text style={styles.headActionLabel}>New drill</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.meta}>
            {drills.length === 0
              ? 'A drill is a coaching aid: a name, what it trains, and the timer to run it by.'
              : `${drills.length} drill${drills.length === 1 ? '' : 's'}. Run one for its timer.`}
          </Text>

          {drillsPhase === 'loading' ? <ActivityIndicator color={ci.color.primary} /> : null}

          {drills.map(drill => (
            <View key={drill.id} style={styles.drillRow}>
              <View style={styles.drillText}>
                <Text style={styles.drillName}>{drill.name}</Text>
                <Text style={styles.meta}>{summarizeDrill(drill)}</Text>
              </View>
              <Pressable
                style={styles.drillRun}
                onPress={() => setPane({ kind: 'run', drill })}
                accessibilityRole="button"
                accessibilityLabel={`Run ${drill.name} timer`}
              >
                <Text style={styles.drillRunLabel}>Run</Text>
              </Pressable>
              {canEdit ? (
                <Pressable
                  style={styles.drillEdit}
                  onPress={() => setPane({ kind: 'edit', draft: draftFromDrill(drill) })}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${drill.name}`}
                >
                  <Text style={styles.drillEditLabel}>Edit</Text>
                </Pressable>
              ) : null}
            </View>
          ))}

          {drillsPhase === 'failed' ? (
            <>
              <Text style={styles.error}>{drillsError}</Text>
              <Pressable style={styles.retry} onPress={() => void loadDrills()}>
                <Text style={styles.retryLabel}>Try again</Text>
              </Pressable>
            </>
          ) : null}

          {!canEdit ? (
            <Text style={styles.readOnly}>Only a coach or manager can add or edit drills.</Text>
          ) : null}
        </View>
      ) : null}

      {membership ? (
        <Pressable style={styles.secondary} onPress={onOpenAttendance}>
          <Text style={styles.secondaryLabel}>Open register</Text>
        </Pressable>
      ) : null}

      {phase === 'loading' ? <ActivityIndicator color={ci.color.primary} /> : null}

      {savedNote ? <Text style={styles.saved}>{savedNote}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {drillNotice ? <Text style={styles.notice}>{drillNotice}</Text> : null}

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
  screen: { padding: 16, gap: 12, backgroundColor: ci.color.background },
  header: { gap: 2 },
  title: { color: ci.color.text, fontSize: 22, fontWeight: '800' },
  headerMeta: { color: ci.color.muted, fontSize: 13 },
  card: { padding: 14, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 10 },
  cardTitle: { color: ci.color.text, fontSize: 16, fontWeight: '800' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headAction: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: ci.radius.chip, backgroundColor: ci.color.accent },
  headActionLabel: { color: ci.color.onAccent, fontSize: 13, fontWeight: '800' },
  drillRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: ci.radius.control, backgroundColor: ci.color.background },
  drillText: { flex: 1, gap: 2 },
  drillName: { color: ci.color.text, fontSize: 15, fontWeight: '700' },
  drillRun: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: ci.radius.chip, backgroundColor: ci.color.go },
  drillRunLabel: { color: ci.color.onGo, fontSize: 13, fontWeight: '800' },
  drillEdit: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised },
  drillEditLabel: { color: ci.color.primary, fontSize: 13, fontWeight: '700' },
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
  secondary: { padding: 12, borderRadius: ci.radius.control, backgroundColor: ci.color.raised, alignItems: 'center' },
  secondaryLabel: { color: ci.color.text, fontSize: 15, fontWeight: '700' },
  saved: { color: ci.color.go, fontSize: 13 },
  notice: { color: ci.color.warning, fontSize: 13, lineHeight: 19 },
  error: { color: ci.color.danger, fontSize: 13, lineHeight: 19 },
  retry: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised, alignSelf: 'flex-start' },
  retryLabel: { color: ci.color.primary, fontSize: 14, fontWeight: '700' },
} as const;
