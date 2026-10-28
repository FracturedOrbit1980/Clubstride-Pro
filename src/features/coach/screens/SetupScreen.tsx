import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { loadOutbox, mintRowId, outboxStorageKey, useSyncQueue } from '../../../core/sync';
import { supabase } from '../../../core/supabaseClient';
import { cacheKey, readCache, writeCache } from '../attendance/cache';
import { ci } from '../../shared/ci';
import { DEMO_DRILLS, DEMO_USER_ID } from '../../shared/demo';
import { useClubRoster } from '../../shared/ClubRosterProvider';
import { TrainingDaysCard } from '../components/TrainingDaysCard';
import { DRILL_LIBRARY } from '../drills/drillLibrary';
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
 * hand over the squad. The picker itself is shared with Settings.
 *
 * The save path matches the rest of Pro: the phone writes to its outbox first and the screen
 * says so, because the setup screen is often used at a ground with no signal.
 */
export const SetupScreen: React.FC<{ onOpenAttendance: () => void }> = ({ onOpenAttendance }) => {
  const { user, isStaff } = useAuth();
  const { queue } = useSyncQueue();
  const { membership, local, preview, warning } = useClubRoster();
  const teamId = membership?.teamId ?? null;
  const installationId = local?.installationId ?? null;
  const userId = preview ? (installationId ? `lite-${installationId}` : DEMO_USER_ID) : user?.id ?? null;
  const canEdit = !(preview && warning) && (preview || (teamId !== null && isStaff(teamId)));

  const [drills, setDrills] = useState<Drill[]>([]);
  const [drillsPhase, setDrillsPhase] = useState<Phase>('loading');
  const [drillsError, setDrillsError] = useState<string | null>(null);
  const [drillNotice, setDrillNotice] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>({ kind: 'list' });

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
    if (preview && !installationId) {
      setDrills(warning || local ? [] : DEMO_DRILLS);
      setDrillsPhase('ready');
      return;
    }
    if (!teamId || !userId) {
      setDrills([]);
      setDrillsPhase('ready');
      return;
    }
    setDrillsPhase('loading');
    setDrillsError(null);
    const key = cacheKey('drills', userId, teamId);
    const cached = await readCache(key);
    const localDrills = parseDrillRows(cached.raw);
    if (cached.warning) setDrillNotice(cached.warning);
    if (cached.raw !== null) {
      setDrills(localDrills.drills);
      setDrillsPhase('ready');
    }
    if (preview) {
      setDrills(localDrills.drills);
      setDrillsPhase('ready');
      return;
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
      setDrills(mergeDrills(withoutDrills(localDrills.drills, removed), pending));
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
    const cacheWarning = await writeCache(key, merged.map(toDrillRow));
    if (cacheWarning) setDrillNotice(cacheWarning);
  }, [preview, installationId, local, warning, teamId, userId]);

  useEffect(() => {
    void loadDrills();
  }, [loadDrills]);

  const saveDrill = async (draft: DrillDraft): Promise<string | null> => {
    if (!teamId || !userId) return 'Drills belong to a squad, and this account is not on one yet.';
    if (!canEdit) return 'Only a coach or manager can save drills for this squad.';
    const id = draft.id ?? mintRowId();
    const drill = drillFromDraft(draft, id);
    if (preview) {
      const next = sortDrills(draft.id ? drills.map(item => (item.id === id ? drill : item)) : [...drills, drill]);
      if (installationId) {
        const warning = await persistDrills(next);
        if (warning) return warning;
      }
      setDrills(next);
      setPane({ kind: 'list' });
      setDrillNotice(installationId ? 'Saved on this device.' : null);
      return null;
    }
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
    if (!canEdit) return 'Only a coach or manager can delete drills for this squad.';
    if (preview) {
      const next = drills.filter(item => item.id !== draft.id);
      if (installationId) {
        const warning = await persistDrills(next);
        if (warning) return warning;
      }
      setDrills(next);
      setPane({ kind: 'list' });
      setDrillNotice(installationId ? 'Saved on this device.' : null);
      return null;
    }
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

  // Names, not ids: a copied library drill gets a fresh row id of its own, so the only thing that
  // can tell a coach they already run this one is its name.
  const squadNames = new Set(drills.map(drill => drill.name.trim().toLowerCase()));

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

      {warning ? <Text style={styles.error}>{warning}</Text> : null}
      <TrainingDaysCard />

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
        <View style={styles.card}>
          <Text style={styles.label}>Coaching library</Text>
          <Text style={styles.meta}>
            Ten drills every coach runs, each with a diagram, the movement playing and what to
            watch for. Open one on the pitch, or copy it into this squad.
          </Text>
          {DRILL_LIBRARY.map(drill => {
            const copied = squadNames.has(drill.name.trim().toLowerCase());
            return (
              <View key={drill.id} style={styles.drillRow}>
                <View style={styles.drillText}>
                  <Text style={styles.drillName}>{drill.name}</Text>
                  <Text style={styles.meta}>{summarizeDrill(drill)}</Text>
                </View>
                <Pressable
                  style={styles.drillRun}
                  onPress={() => setPane({ kind: 'run', drill })}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${drill.name} with its diagram`}
                >
                  <Text style={styles.drillRunLabel}>Open</Text>
                </Pressable>
                {canEdit ? (
                  <Pressable
                    style={styles.drillEdit}
                    onPress={() => setPane({ kind: 'edit', draft: { ...draftFromDrill(drill), id: null } })}
                    accessibilityRole="button"
                    accessibilityLabel={
                      copied
                        ? `Copy ${drill.name} into this squad again`
                        : `Copy ${drill.name} into this squad`
                    }
                  >
                    <Text style={styles.drillEditLabel}>{copied ? 'Copy again' : 'Copy'}</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {membership ? (
        <Pressable style={styles.secondary} onPress={onOpenAttendance}>
          <Text style={styles.secondaryLabel}>Open register</Text>
        </Pressable>
      ) : null}

      {drillNotice ? <Text style={styles.notice}>{drillNotice}</Text> : null}
    </ScrollView>
  );
};

const styles = {
  screen: { padding: 16, gap: 12, backgroundColor: ci.color.background },
  header: { gap: 2 },
  title: { color: ci.color.text, fontSize: 22, fontWeight: '800' },
  headerMeta: { color: ci.color.muted, fontSize: 13 },
  card: { padding: 14, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 10 },
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
  readOnly: { color: ci.color.warning, fontSize: 13 },
  secondary: { padding: 12, borderRadius: ci.radius.control, backgroundColor: ci.color.raised, alignItems: 'center' },
  secondaryLabel: { color: ci.color.text, fontSize: 15, fontWeight: '700' },
  notice: { color: ci.color.warning, fontSize: 13, lineHeight: 19 },
  error: { color: ci.color.danger, fontSize: 13, lineHeight: 19 },
  retry: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised, alignSelf: 'flex-start' },
  retryLabel: { color: ci.color.primary, fontSize: 14, fontWeight: '700' },
} as const;
