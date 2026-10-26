import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import * as Print from 'expo-print';
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
import { buildAttendanceRegisterHtml } from '../attendance/register';
import { parseSquadRows, type SquadPlayerRow } from '../attendance/squad';
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

const REGISTER_PRINT_ROOT_ID = 'attendance-register-print';

/**
 * Expo Print's web build prints the current page, not the HTML it is handed, and mobile
 * browsers do not reliably print a child frame. So the register is mounted into the page for
 * the print pass instead: print CSS hides the app shell, and the browser's "Save as PDF" is
 * the download path. Phones get a real PDF from Print.printToFileAsync and share it.
 */
const printRegisterOnWeb = (html: string): void => {
  document.getElementById(REGISTER_PRINT_ROOT_ID)?.remove();
  document.getElementById(`${REGISTER_PRINT_ROOT_ID}-style`)?.remove();

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const registerCss = Array.from(parsed.querySelectorAll('style'))
    .map(sheet => sheet.textContent ?? '')
    .join('\n');

  const root = document.createElement('div');
  root.id = REGISTER_PRINT_ROOT_ID;
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = parsed.body.innerHTML;

  const style = document.createElement('style');
  style.id = `${REGISTER_PRINT_ROOT_ID}-style`;
  style.textContent = `
    #${REGISTER_PRINT_ROOT_ID} { display: none; }
    @media print {
      html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; background: #ffffff !important; }
      body > *:not(#${REGISTER_PRINT_ROOT_ID}) { display: none !important; }
      #${REGISTER_PRINT_ROOT_ID} { display: block !important; }
      ${registerCss}
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(root);

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    root.remove();
    style.remove();
  };
  // Mobile print previews can finish taking their snapshot before afterprint fires.
  window.addEventListener('afterprint', () => setTimeout(cleanup, 1500), { once: true });
  try {
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
  // A print dialog that never closes must not leave the register pinned to the app.
  setTimeout(cleanup, 60000);
};

/**
 * Attendance is taken per session, not per week: the strip picks a training day, then every
 * player on the squad gets one of four statuses. Writes go through the outbox exactly like
 * match events, so a coach at a ground with no signal still records the session.
 *
 * Reads are local-first. Squad, training days and the marks already on this phone render
 * before the network is asked, and a failed refresh is shown instead of leaving a blank list.
 */
export const AttendanceScreen: React.FC<{ onBack: () => void; onOpenSetup: () => void }> = ({
  onBack,
  onOpenSetup,
}) => {
  const { memberships, user, isStaff } = useAuth();
  const { queue } = useSyncQueue();
  const membership = memberships.find(m => m.role !== 'parent') ?? memberships[0] ?? null;
  const teamId = membership?.teamId ?? null;
  const userId = user?.id ?? null;
  const canEdit = teamId !== null && isStaff(teamId);

  const [phase, setPhase] = useState<Phase>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [weekStart, setWeekStart] = useState(() => mondayOf(sessionToday()));
  const [players, setPlayers] = useState<SquadPlayerRow[]>([]);
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
      if (!userId || !teamId) return;
      const key = cacheKey('attendance', userId, teamId);
      saveChain.current = saveChain.current.then(async () => {
        const warning = await writeCache(key, Object.values(map));
        if (warning) setNotice(warning);
      });
    },
    [teamId, userId],
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
      setPlayers([]);
      setSelectedDate('');
      setNotice(null);
      setBaseError(null);
      setWeekError(null);
      setSaveError(null);
      setExportError(null);
      if (teamId && userId) setPhase('loading');
    }

    if (!teamId || !userId) {
      setPhase('ready');
      return () => {
        active = false;
      };
    }

    const squadKey = cacheKey('squad', userId, teamId);
    const trainingKey = cacheKey('training', userId, teamId);
    const attendanceKeyOnPhone = cacheKey('attendance', userId, teamId);

    void (async () => {
      const [squadRead, trainingRead, attendanceRead] = await Promise.all([
        readCache(squadKey),
        readCache(trainingKey),
        readCache(attendanceKeyOnPhone),
      ]);
      if (!active) return;

      const notes: string[] = [];
      for (const warning of [squadRead.warning, trainingRead.warning, attendanceRead.warning]) {
        if (warning) notes.push(warning);
      }

      const cachedSquad = parseSquadRows(squadRead.raw);
      const cachedTraining = parseTrainingSettings(trainingRead.raw);
      const cachedAttendance = parseAttendanceRows(attendanceRead.raw);

      setPlayers(cachedSquad.players);
      trainingRef.current = pickNewerTrainingSettings(trainingRef.current, cachedTraining);
      setTraining(trainingRef.current);
      mergeRecords(cachedAttendance.rows);
      setPhase('ready');

      if (cachedSquad.dropped > 0) notes.push(`${cachedSquad.dropped} saved squad row(s) could not be read.`);
      if (cachedAttendance.dropped > 0) notes.push(`${cachedAttendance.dropped} saved attendance row(s) could not be read.`);
      if (notes.length > 0) setNotice(notes.join(' '));

      const [squadResult, trainingResult] = await Promise.all([
        supabase
          .from('players')
          .select('id, full_name, shirt_number, position_tag, available')
          .eq('team_id', teamId)
          .is('deleted_at', null)
          .order('shirt_number', { ascending: true }),
        supabase
          .from('team_settings')
          .select('training_days, recorded_at')
          .eq('id', teamId)
          .maybeSingle(),
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
  }, [teamId, userId, reloadKey, mergeRecords]);

  // --- the displayed week ---------------------------------------------------------------

  useEffect(() => {
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
  }, [teamId, userId, weekStart, reloadKey, mergeRecords]);

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

  const playerIds = useMemo(() => players.map(player => player.id), [players]);
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
    if (exporting || !membership || sessions.length === 0 || players.length === 0) return;
    setExportError(null);
    setExporting(true);
    try {
      const html = buildAttendanceRegisterHtml({
        teamName: membership.teamName,
        weekStart,
        trainingDays: training.days,
        sessions,
        players,
        records: recordsRef.current,
      });
      if (Platform.OS === 'web') {
        printRegisterOnWeb(html);
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            dialogTitle: 'Attendance register',
            UTI: 'com.adobe.pdf',
          });
        } else {
          await Print.printAsync({ html });
        }
      }
    } catch (error) {
      setExportError(
        `The register PDF was not created: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setExporting(false);
    }
  };

  const canExport = sessions.length > 0 && players.length > 0;

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
        <Pressable style={styles.back} onPress={onBack}>
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Attendance</Text>
          <Text style={styles.headerMeta}>
            {membership ? `${membership.teamName}${roleLabel ? ` - ${roleLabel}` : ''}` : 'No squad yet'}
          </Text>
        </View>
      </View>

      {phase === 'loading' ? <ActivityIndicator color="#facc15" /> : null}

      {phase === 'ready' && !membership ? (
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
            {canExport && Platform.OS === 'web' ? (
              <Text style={styles.exportHint}>Opens the print dialog - choose "Save as PDF".</Text>
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
                Attendance has no sessions until the weekdays this squad trains are chosen in Setup.
              </Text>
              <Pressable style={styles.secondary} onPress={onOpenSetup}>
                <Text style={styles.secondaryLabel}>Open setup</Text>
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
                    {canEdit
                      ? 'Marks save on this phone first, then sync.'
                      : 'Only a coach or manager can change these marks.'}
                  </Text>
                  <Pressable onPress={onOpenSetup}>
                    <Text style={styles.link}>{canEdit ? 'Edit training days' : 'View training days'}</Text>
                  </Pressable>
                </View>
              </View>

              {players.length === 0 ? (
                <Text style={styles.meta}>No players are visible to this account.</Text>
              ) : (
                players.map(player => {
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
  present: { button: { backgroundColor: '#166534', borderColor: '#22c55e' }, label: { color: '#dcfce7' } },
  late: { button: { backgroundColor: '#92400e', borderColor: '#f59e0b' }, label: { color: '#fef3c7' } },
  absent: { button: { backgroundColor: '#7f1d1d', borderColor: '#ef4444' }, label: { color: '#fee2e2' } },
  excused: { button: { backgroundColor: '#334155', borderColor: '#64748b' }, label: { color: '#e2e8f0' } },
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
  meta: { color: '#cbd5e1', fontSize: 13, lineHeight: 19 },
  secondary: { paddingVertical: 12, borderRadius: 10, backgroundColor: '#263043', alignItems: 'center' },
  secondaryLabel: { color: '#e2e8f0', fontSize: 14, fontWeight: '700' },
  weekCard: { padding: 12, borderRadius: 14, backgroundColor: '#1b1b22', gap: 12 },
  weekNav: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weekArrow: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekArrowLabel: { color: '#facc15', fontSize: 22, fontWeight: '800', lineHeight: 24 },
  weekTitle: { flex: 1, alignItems: 'center', gap: 2 },
  weekRange: { color: '#e2e8f0', fontSize: 15, fontWeight: '800' },
  weekMeta: { color: '#94a3b8', fontSize: 12 },
  weekLink: { color: '#facc15', fontSize: 12, fontWeight: '700' },
  dayRow: { flexDirection: 'row', gap: 4 },
  day: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#273449',
  },
  daySelected: { backgroundColor: '#facc15', borderColor: '#facc15' },
  exportButton: {
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#facc15',
    backgroundColor: '#111827',
    alignItems: 'center',
  },
  exportButtonOff: { opacity: 0.5 },
  exportLabel: { color: '#facc15', fontSize: 13, fontWeight: '800' },
  exportHint: { color: '#94a3b8', fontSize: 11, lineHeight: 16, textAlign: 'center' },
  dayOff: { opacity: 0.35 },
  dayToday: { borderColor: '#facc15' },
  dayName: { color: '#94a3b8', fontSize: 10, fontWeight: '700' },
  dayNumber: { color: '#e2e8f0', fontSize: 15, fontWeight: '800' },
  daySelectedText: { color: '#111115' },
  warningCard: { padding: 12, borderRadius: 12, backgroundColor: '#1b1b22', gap: 8 },
  error: { color: '#f87171', fontSize: 13, lineHeight: 19 },
  notice: { color: '#facc15', fontSize: 13, lineHeight: 19 },
  retry: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#111827', alignSelf: 'flex-start' },
  retryLabel: { color: '#facc15', fontSize: 14, fontWeight: '700' },
  sessionCard: { padding: 14, borderRadius: 14, backgroundColor: '#1b1b22', gap: 10 },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sessionText: { flex: 1, gap: 3 },
  sessionDate: { color: '#e2e8f0', fontSize: 17, fontWeight: '800' },
  sessionCounts: { color: '#cbd5e1', fontSize: 13 },
  rateBadge: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#111827',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#273449',
  },
  rateValue: { color: '#facc15', fontSize: 17, fontWeight: '800' },
  rateLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '700' },
  sessionFooter: { gap: 6 },
  saveHint: { color: '#94a3b8', fontSize: 12, lineHeight: 17 },
  link: { color: '#facc15', fontSize: 12, fontWeight: '700' },
  playerRow: { padding: 12, borderRadius: 14, backgroundColor: '#1b1b22', gap: 10 },
  playerHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shirt: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#facc15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shirtLabel: { color: '#0b0f17', fontSize: 14, fontWeight: '800' },
  playerText: { flex: 1, gap: 2 },
  playerName: { color: '#e2e8f0', fontSize: 15, fontWeight: '700' },
  playerMeta: { color: '#94a3b8', fontSize: 12 },
  playerStatus: { color: '#facc15', fontSize: 12, fontWeight: '700' },
  statusRow: { flexDirection: 'row', gap: 6 },
  status: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: 'center',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#273449',
  },
  statusLabel: { color: '#94a3b8', fontSize: 11, fontWeight: '700' },
} as const;
