import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useAuth } from '../../../core/context/AuthContext';
import { stableRowId, useSyncQueue } from '../../../core/sync';
import { supabase } from '../../../core/supabaseClient';
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABEL,
  attendanceKey,
  attendanceRate,
  countStatuses,
  describeCounts,
  mergeAttendance,
  parseAttendanceRows,
  withAttendance,
  type AttendanceMap,
  type AttendanceRow,
  type AttendanceStatus,
} from '../attendance/attendance';
import { cacheKey, readCache, writeCache } from '../attendance/cache';
import { attendanceRegisterFileName, buildAttendanceRegisterPdf } from '../attendance/register';
import { ci } from '../../shared/ci';
import { DEMO_USER_ID, demoAttendance, previewTrainingSettings } from '../../shared/demo';
import { useClubRoster } from '../../shared/ClubRosterProvider';
import {
  parseTrainingSettings,
  pickNewerTrainingSettings,
  sessionsInWeek,
  weekdayShort,
  type TrainingSettings,
} from '../attendance/trainingDays';
import {
  addDays,
  formatDay,
  formatWeekRange,
  mondayOf,
  sessionToday,
  weekDates,
  weekdayOf,
} from '../attendance/week';

type Phase = 'loading' | 'ready';

const mergeFailure = (parts: string[]): string | null => (parts.length === 0 ? null : parts.join(' '));

const downloadRegisterOnWeb = (bytes: Uint8Array<ArrayBuffer>, fileName: string): void => {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

/**
 * Attendance is taken per session, not per week: the strip picks a training day, then every
 * player on the squad gets one of four statuses. Writes go through the outbox exactly like
 * match events, so a coach at a ground with no signal still records the session.
 *
 * Reads are local-first. Squad, training days and the marks already on this phone render
 * before the network is asked, and a failed refresh is shown instead of leaving a blank list.
 */
export const AttendanceScreen: React.FC<{ onOpenSetup: () => void }> = ({ onOpenSetup }) => {
  const { user, isStaff } = useAuth();
  const { queue } = useSyncQueue();
  const { membership, local, preview, previewPlayers, revision, warning } = useClubRoster();
  const teamId = membership?.teamId ?? null;
  const installationId = local?.installationId ?? null;
  const userId = preview ? (installationId ? `lite-${installationId}` : DEMO_USER_ID) : user?.id ?? null;
  const canEdit = !(preview && warning) && (preview || (teamId !== null && isStaff(teamId)));

  const [phase, setPhase] = useState<Phase>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [weekStart, setWeekStart] = useState(() => mondayOf(sessionToday()));
  const visiblePlayers = previewPlayers;
  const [training, setTraining] = useState<TrainingSettings>({ days: [], recordedAt: null });
  const [records, setRecords] = useState<AttendanceMap>({});
  const [selectedDate, setSelectedDate] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [baseError, setBaseError] = useState<string | null>(null);
  const [weekError, setWeekError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const recordsRef = useRef<AttendanceMap>({});
  const trainingRef = useRef<TrainingSettings>({ days: [], recordedAt: null });
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const scopeRef = useRef('');

  const persistRecords = useCallback(
    (map: AttendanceMap): void => {
      if ((preview && !installationId) || !userId || !teamId) return;
      const key = cacheKey('attendance', userId, teamId);
      saveChain.current = saveChain.current.then(async () => {
        const warning = await writeCache(key, Object.values(map));
        if (warning) setNotice(warning);
      });
    },
    [preview, installationId, teamId, userId],
  );

  const mergeRecords = useCallback(
    (rows: readonly AttendanceRow[]): void => {
      const next = mergeAttendance(recordsRef.current, rows);
      recordsRef.current = next;
      setRecords(next);
      persistRecords(next);
    },
    [persistRecords],
  );

  // --- local cache first, then the club ------------------------------------------------

  useEffect(() => {
    let active = true;
    const scope = `${userId ?? ''}|${teamId ?? ''}`;
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      recordsRef.current = {};
      trainingRef.current = { days: [], recordedAt: null };
      setRecords({});
      setTraining(trainingRef.current);
      setSelectedDate('');
      setNotice(null);
      setBaseError(null);
      setWeekError(null);
      setSaveError(null);
      setExportError(null);
      if (teamId && userId) setPhase('loading');
    }

    if (preview) {
      if (!installationId || !teamId || !userId) {
        trainingRef.current = warning || local ? { days: [], recordedAt: null } : previewTrainingSettings();
        setTraining(trainingRef.current);
        setPhase('ready');
        return;
      }
      void (async () => {
        const [trainingRead, attendanceRead] = await Promise.all([
          readCache(cacheKey('training', userId, teamId)),
          readCache(cacheKey('attendance', userId, teamId)),
        ]);
        if (!active) return;
        const parsed = parseAttendanceRows(attendanceRead.raw);
        trainingRef.current = parseTrainingSettings(trainingRead.raw);
        setTraining(trainingRef.current);
        recordsRef.current = mergeAttendance(recordsRef.current, parsed.rows);
        setRecords(recordsRef.current);
        const notices = [trainingRead.warning, attendanceRead.warning,
          parsed.dropped ? `${parsed.dropped} saved attendance row(s) could not be read.` : null].filter(Boolean);
        setNotice(notices.join(' ') || null);
        setPhase('ready');
      })();
      return () => { active = false; };
    }

    if (!teamId || !userId) {
      setPhase('ready');
      return () => {
        active = false;
      };
    }

    const trainingKey = cacheKey('training', userId, teamId);
    const attendanceKeyOnPhone = cacheKey('attendance', userId, teamId);

    void (async () => {
      const [trainingRead, attendanceRead] = await Promise.all([
        readCache(trainingKey),
        readCache(attendanceKeyOnPhone),
      ]);
      if (!active) return;

      const notes: string[] = [];
      for (const warning of [trainingRead.warning, attendanceRead.warning]) {
        if (warning) notes.push(warning);
      }

      const cachedTraining = parseTrainingSettings(trainingRead.raw);
      const cachedAttendance = parseAttendanceRows(attendanceRead.raw);

      trainingRef.current = pickNewerTrainingSettings(trainingRef.current, cachedTraining);
      setTraining(trainingRef.current);
      mergeRecords(cachedAttendance.rows);
      setPhase('ready');

      if (cachedAttendance.dropped > 0) notes.push(`${cachedAttendance.dropped} saved attendance row(s) could not be read.`);
      if (notes.length > 0) setNotice(notes.join(' '));

      const trainingResult = await supabase
        .from('team_settings')
        .select('training_days, recorded_at')
        .eq('id', teamId)
        .maybeSingle();
      if (!active) return;

      const failures: string[] = [];
      if (trainingResult.error) {
        // The strip above is already drawn from the cached days, so say that rather than
        // implying the squad has no schedule until the club can be reached.
        failures.push(
          trainingRef.current.days.length > 0
            ? `Training days: showing the copy saved on this phone. The club copy could not be read: ${trainingResult.error.message}`
            : `Training days: ${trainingResult.error.message}`,
        );
      } else {
        const winner = pickNewerTrainingSettings(trainingRef.current, parseTrainingSettings(trainingResult.data));
        trainingRef.current = winner;
        setTraining(winner);
        const warning = await writeCache(trainingKey, {
          training_days: winner.days,
          recorded_at: winner.recordedAt,
        });
        if (warning) failures.push(warning);
      }

      if (active) setBaseError(mergeFailure(failures));
    })();

    return () => {
      active = false;
    };
  }, [preview, installationId, local, revision, warning, teamId, userId, reloadKey, mergeRecords]);

  // --- the displayed week ---------------------------------------------------------------

  useEffect(() => {
    if (preview) {
      if (!installationId && !warning) mergeRecords(demoAttendance(weekStart, sessionToday()));
      return;
    }
    if (!teamId || !userId) return;
    let active = true;
    const week = weekStart;
    void (async () => {
      const { data, error } = await supabase
        .from('attendance')
        .select('id, player_id, session_date, status, recorded_at')
        .eq('team_id', teamId)
        .eq('session_type', 'practice')
        .gte('session_date', week)
        .lte('session_date', addDays(week, 6))
        .is('deleted_at', null);
      if (!active) return;
      if (error) {
        setWeekError(`This week could not be refreshed: ${error.message}`);
        return;
      }
      const parsed = parseAttendanceRows(data);
      setWeekError(parsed.dropped > 0 ? `${parsed.dropped} attendance row(s) came back unreadable.` : null);
      mergeRecords(parsed.rows);
    })();

    return () => {
      active = false;
    };
  }, [preview, installationId, warning, revision, teamId, userId, weekStart, reloadKey, mergeRecords]);

  // --- which session is open --------------------------------------------------------------

  const today = sessionToday();
  const sessions = useMemo(() => sessionsInWeek(weekStart, training.days), [weekStart, training.days]);

  useEffect(() => {
    setSelectedDate(current => {
      if (current && sessions.includes(current)) return current;
      if (sessions.length === 0) return '';
      if (sessions.includes(today)) return today;
      const past = sessions.filter(date => date < today);
      return past[past.length - 1] ?? sessions[0] ?? '';
    });
  }, [sessions, today]);

  const playerIds = useMemo(() => visiblePlayers.map(player => player.id), [visiblePlayers]);
  const counts = useMemo(
    () => (selectedDate ? countStatuses(playerIds, records, selectedDate) : null),
    [playerIds, records, selectedDate],
  );
  const rate = counts ? attendanceRate(counts) : null;

  const mark = (playerId: string, status: AttendanceStatus): void => {
    if (!canEdit || !teamId || !selectedDate) return;
    const existing = recordsRef.current[attendanceKey(playerId, selectedDate)];
    if (existing?.status === status) return;

    setSaveError(null);
    const recordedAt = new Date().toISOString();
    const row: AttendanceRow = {
      // Deterministic: the same player and session on another phone produces this same id,
      // so two offline marks become one upsert instead of a unique-constraint failure.
      id: stableRowId('attendance', playerId, selectedDate, 'practice'),
      player_id: playerId,
      session_date: selectedDate,
      status,
      recorded_at: recordedAt,
    };
    if (preview) {
      const next = withAttendance(recordsRef.current, row);
      recordsRef.current = next;
      setRecords(next);
      if (installationId) persistRecords(next);
      return;
    }

    const queued = queue.enqueue({
      table: 'attendance',
      rowId: row.id,
      op: 'upsert',
      requiresRowId: null,
      recordedAt,
      payload: {
        team_id: teamId,
        player_id: row.player_id,
        session_date: row.session_date,
        session_type: 'practice',
        status: row.status,
        recorded_at: row.recorded_at,
      },
    });
    if (!queued) {
      setSaveError(
        'This mark was not saved: the sync queue is not attached to an account. Sign in again, then mark the player.',
      );
      return;
    }

    const next = withAttendance(recordsRef.current, row);
    recordsRef.current = next;
    setRecords(next);
    persistRecords(next);
  };

  const exportRegister = async (): Promise<void> => {
    if (exporting || !membership || sessions.length === 0 || visiblePlayers.length === 0) return;
    setExportError(null);
    setExporting(true);
    try {
      const bytes = buildAttendanceRegisterPdf({
        teamName: membership.teamName,
        weekStart,
        trainingDays: training.days,
        sessions,
        players: visiblePlayers,
        records: recordsRef.current,
      });
      const fileName = attendanceRegisterFileName(membership.teamName, weekStart);
      if (Platform.OS === 'web') {
        downloadRegisterOnWeb(bytes, fileName);
      } else {
        const file = new File(Paths.cache, fileName);
        if (file.exists) file.delete();
        await file.write(bytes);
        if (!(await Sharing.isAvailableAsync())) {
          throw new Error('Sharing is not available on this device.');
        }
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Attendance register',
          UTI: 'com.adobe.pdf',
        });
      }
    } catch (error) {
      setExportError(
        `The register PDF was not created: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setExporting(false);
    }
  };

  const canExport = sessions.length > 0 && visiblePlayers.length > 0;

  const roleLabel = membership
    ? membership.role === 'manager'
      ? 'Manager'
      : membership.role === 'coach'
        ? 'Coach'
        : 'Parent'
    : null;
  const isCurrentWeek = weekStart === mondayOf(today);

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Register</Text>
        <Text style={styles.headerMeta}>
          {membership ? `${membership.teamName}${roleLabel ? ` - ${roleLabel}` : ''}` : 'No squad yet'}
        </Text>
      </View>

      {warning ? <Text style={styles.error}>{warning}</Text> : null}
      {phase === 'loading' ? <ActivityIndicator color={ci.color.primary} /> : null}

      {phase === 'ready' && !membership && !warning ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No squad on this account</Text>
          <Text style={styles.meta}>Attendance belongs to a squad, and this account is not on one yet.</Text>
        </View>
      ) : null}

      {phase === 'ready' && membership ? (
        <>
          <View style={styles.weekCard}>
            <View style={styles.weekNav}>
              <Pressable
                style={styles.weekArrow}
                onPress={() => setWeekStart(addDays(weekStart, -7))}
                accessibilityRole="button"
                accessibilityLabel="Previous week"
              >
                <Text style={styles.weekArrowLabel}>‹</Text>
              </Pressable>
              <View style={styles.weekTitle}>
                <Text style={styles.weekRange}>{formatWeekRange(weekStart)}</Text>
                {isCurrentWeek ? (
                  <Text style={styles.weekMeta}>This week</Text>
                ) : (
                  <Pressable onPress={() => setWeekStart(mondayOf(today))}>
                    <Text style={styles.weekLink}>Back to this week</Text>
                  </Pressable>
                )}
              </View>
              <Pressable
                style={styles.weekArrow}
                onPress={() => setWeekStart(addDays(weekStart, 7))}
                accessibilityRole="button"
                accessibilityLabel="Next week"
              >
                <Text style={styles.weekArrowLabel}>›</Text>
              </Pressable>
            </View>

            <View style={styles.dayRow}>
              {weekDates(weekStart).map(date => {
                const isTrainingDay = training.days.includes(weekdayOf(date));
                const isSelected = date === selectedDate;
                const isToday = date === today;
                return (
                  <Pressable
                    key={date}
                    disabled={!isTrainingDay}
                    onPress={() => setSelectedDate(date)}
                    accessibilityRole="button"
                    accessibilityLabel={formatDay(date)}
                    accessibilityState={{ selected: isSelected, disabled: !isTrainingDay }}
                    style={[
                      styles.day,
                      isSelected && styles.daySelected,
                      !isTrainingDay && styles.dayOff,
                      isToday && !isSelected && styles.dayToday,
                    ]}
                  >
                    <Text style={[styles.dayName, isSelected && styles.daySelectedText]}>
                      {weekdayShort(weekdayOf(date))}
                    </Text>
                    <Text style={[styles.dayNumber, isSelected && styles.daySelectedText]}>
                      {Number(date.slice(8, 10))}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {canExport ? (
              <Pressable
                onPress={() => void exportRegister()}
                disabled={exporting}
                accessibilityRole="button"
                accessibilityLabel="Export this week's attendance register as a PDF"
                style={[styles.exportButton, exporting && styles.exportButtonOff]}
              >
                <Text style={styles.exportLabel}>
                  {exporting ? 'Preparing register...' : 'Export register PDF'}
                </Text>
              </Pressable>
            ) : null}
            {canExport ? (
              <Text style={styles.exportHint}>
                {Platform.OS === 'web'
                  ? "Downloads this week's register as a PDF."
                  : 'Shares a PDF you can save or send.'}
              </Text>
            ) : null}
            {exportError ? <Text style={styles.error}>{exportError}</Text> : null}
          </View>

          {baseError || weekError ? (
            <View style={styles.warningCard}>
              {baseError ? <Text style={styles.error}>{baseError}</Text> : null}
              {weekError ? <Text style={styles.error}>{weekError}</Text> : null}
              <Pressable style={styles.retry} onPress={() => setReloadKey(key => key + 1)}>
                <Text style={styles.retryLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {saveError ? <Text style={styles.error}>{saveError}</Text> : null}

          {training.days.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>No training days set</Text>
              <Text style={styles.meta}>
                Attendance has no sessions until the weekdays this squad trains are chosen in Training.
              </Text>
              <Pressable style={styles.secondary} onPress={onOpenSetup}>
                <Text style={styles.secondaryLabel}>Open training</Text>
              </Pressable>
            </View>
          ) : null}

          {training.days.length > 0 && selectedDate && counts ? (
            <>
              <View style={styles.sessionCard}>
                <View style={styles.sessionHead}>
                  <View style={styles.sessionText}>
                    <Text style={styles.sessionDate}>
                      {formatDay(selectedDate)}
                      {selectedDate === today ? ' - Today' : ''}
                    </Text>
                    <Text style={styles.sessionCounts}>{describeCounts(counts)}</Text>
                  </View>
                  {rate !== null ? (
                    <View style={styles.rateBadge}>
                      <Text style={styles.rateValue}>{rate}%</Text>
                      <Text style={styles.rateLabel}>attended</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.sessionFooter}>
                  <Text style={styles.saveHint}>
                    {preview
                      ? installationId ? 'These marks save on this device for the same team in Lite and Pro. Cloud storage requires an authorized matching club team.' : 'Preview squad: marks change this screen only and are not sent anywhere.'
                      : canEdit
                        ? 'Marks save on this phone first, then sync.'
                        : 'Only a coach or manager can change these marks.'}
                  </Text>
                  <Pressable onPress={onOpenSetup}>
                    <Text style={styles.link}>{canEdit ? 'Edit training days' : 'View training days'}</Text>
                  </Pressable>
                </View>
              </View>

              {visiblePlayers.length === 0 ? (
                <Text style={styles.meta}>No players are visible to this account.</Text>
              ) : (
                visiblePlayers.map(player => {
                  const entry = records[attendanceKey(player.id, selectedDate)];
                  return (
                    <View key={player.id} style={styles.playerRow}>
                      <View style={styles.playerHead}>
                        <View style={styles.shirt}>
                          <Text style={styles.shirtLabel}>{player.shirt_number}</Text>
                        </View>
                        <View style={styles.playerText}>
                          <Text style={styles.playerName}>{player.full_name}</Text>
                          <Text style={styles.playerMeta}>{player.position_tag ?? 'No position set'}</Text>
                        </View>
                        {!canEdit ? (
                          <Text style={styles.playerStatus}>
                            {entry ? ATTENDANCE_STATUS_LABEL[entry.status] : 'Not marked'}
                          </Text>
                        ) : null}
                      </View>

                      {canEdit ? (
                        <View style={styles.statusRow}>
                          {ATTENDANCE_STATUSES.map(status => {
                            const isOn = entry?.status === status;
                            return (
                              <Pressable
                                key={status}
                                onPress={() => mark(player.id, status)}
                                accessibilityRole="button"
                                accessibilityLabel={`${ATTENDANCE_STATUS_LABEL[status]} for ${player.full_name}`}
                                accessibilityState={{ selected: isOn }}
                                style={[styles.status, isOn && STATUS_ON[status].button]}
                              >
                                <Text style={[styles.statusLabel, isOn && STATUS_ON[status].label]}>
                                  {ATTENDANCE_STATUS_LABEL[status]}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : null}
                    </View>
                  );
                })
              )}
            </>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
};

const STATUS_ON: Record<AttendanceStatus, { button: ViewStyle; label: TextStyle }> = {
  present: { button: { backgroundColor: ci.color.go, borderColor: ci.color.go }, label: { color: ci.color.onGo } },
  late: { button: { backgroundColor: ci.color.warning, borderColor: ci.color.warning }, label: { color: ci.color.onWarning } },
  absent: { button: { backgroundColor: ci.color.danger, borderColor: ci.color.danger }, label: { color: ci.color.onDanger } },
  excused: { button: { backgroundColor: ci.color.disabledBg, borderColor: ci.color.borderInput }, label: { color: ci.color.text } },
};

const styles = {
  screen: { padding: 16, gap: 12, backgroundColor: ci.color.background },
  header: { gap: 2 },
  title: { color: ci.color.text, fontSize: 22, fontWeight: '800' },
  headerMeta: { color: ci.color.muted, fontSize: 13 },
  card: { padding: 14, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 10 },
  cardTitle: { color: ci.color.text, fontSize: 16, fontWeight: '800' },
  meta: { color: ci.color.muted, fontSize: 13, lineHeight: 19 },
  secondary: { paddingVertical: 12, borderRadius: ci.radius.control, backgroundColor: ci.color.raised, alignItems: 'center' },
  secondaryLabel: { color: ci.color.text, fontSize: 14, fontWeight: '700' },
  weekCard: { padding: 12, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 12 },
  weekNav: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weekArrow: {
    width: 38,
    height: 38,
    borderRadius: ci.radius.control,
    backgroundColor: ci.color.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekArrowLabel: { color: ci.color.primary, fontSize: 22, fontWeight: '800', lineHeight: 24 },
  weekTitle: { flex: 1, alignItems: 'center', gap: 2 },
  weekRange: { color: ci.color.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums' as const] },
  weekMeta: { color: ci.color.muted, fontSize: 12 },
  weekLink: { color: ci.color.primary, fontSize: 12, fontWeight: '700' },
  dayRow: { flexDirection: 'row', gap: 4 },
  day: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: ci.radius.control,
    alignItems: 'center',
    gap: 2,
    backgroundColor: ci.color.background,
    borderWidth: 1,
    borderColor: ci.color.border,
  },
  daySelected: { backgroundColor: ci.color.accent, borderColor: ci.color.accent },
  exportButton: {
    paddingVertical: 11,
    borderRadius: ci.radius.control,
    borderWidth: 1,
    borderColor: ci.color.primary,
    backgroundColor: ci.color.background,
    alignItems: 'center',
  },
  exportButtonOff: { opacity: 0.5 },
  exportLabel: { color: ci.color.primary, fontSize: 13, fontWeight: '800' },
  exportHint: { color: ci.color.muted, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  dayOff: { opacity: 0.35 },
  dayToday: { borderColor: ci.color.accent },
  dayName: { color: ci.color.muted, fontSize: 10, fontWeight: '700' },
  dayNumber: { color: ci.color.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums' as const] },
  daySelectedText: { color: ci.color.onAccent },
  warningCard: { padding: 12, borderRadius: ci.radius.control, backgroundColor: ci.color.surface, gap: 8 },
  error: { color: ci.color.danger, fontSize: 13, lineHeight: 19 },
  notice: { color: ci.color.warning, fontSize: 13, lineHeight: 19 },
  retry: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised, alignSelf: 'flex-start' },
  retryLabel: { color: ci.color.primary, fontSize: 14, fontWeight: '700' },
  sessionCard: { padding: 14, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 10 },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sessionText: { flex: 1, gap: 3 },
  sessionDate: { color: ci.color.text, fontSize: 17, fontWeight: '800' },
  sessionCounts: { color: ci.color.muted, fontSize: 13, fontVariant: ['tabular-nums' as const] },
  rateBadge: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: ci.radius.control,
    backgroundColor: ci.color.background,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: ci.color.border,
  },
  rateValue: { color: ci.color.accent, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums' as const] },
  rateLabel: { color: ci.color.muted, fontSize: 10, fontWeight: '700' },
  sessionFooter: { gap: 6 },
  saveHint: { color: ci.color.muted, fontSize: 12, lineHeight: 17 },
  link: { color: ci.color.primary, fontSize: 12, fontWeight: '700' },
  playerRow: { padding: 12, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 10 },
  playerHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shirt: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: ci.color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shirtLabel: { color: ci.color.onAccent, fontSize: 14, fontWeight: '800' },
  playerText: { flex: 1, gap: 2 },
  playerName: { color: ci.color.text, fontSize: 15, fontWeight: '700' },
  playerMeta: { color: ci.color.muted, fontSize: 12 },
  playerStatus: { color: ci.color.accent, fontSize: 12, fontWeight: '700' },
  statusRow: { flexDirection: 'row', gap: 6 },
  status: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: ci.radius.control,
    alignItems: 'center',
    backgroundColor: ci.color.background,
    borderWidth: 1,
    borderColor: ci.color.border,
  },
  statusLabel: { color: ci.color.muted, fontSize: 11, fontWeight: '700' },
} as const;
