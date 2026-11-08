import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { supabase } from '../../../core/supabaseClient';
import {
  ATTENDANCE_STATUS_LABEL,
  indexAttendance,
  parseAttendanceRows,
  summariseAttendance,
  type AttendanceMap,
  type AttendanceStatus,
} from '../../coach/attendance/attendance';
import type { SquadPlayerRow } from '../../coach/attendance/squad';
import { formatTrainingDays, parseTrainingSettings, type TrainingWeekday } from '../../coach/attendance/trainingDays';
import { formatDay, formatWeekRange, mondayOf, sessionToday } from '../../coach/attendance/week';
import {
  CATEGORIES,
  METRICS,
  categoryAverages,
  ratingText,
  rubricLegend,
  type PlayerAssessment,
} from '../../coach/player/assessment';
import { demoAttendanceSeason, previewAssessment, previewTrainingSettings } from '../../shared/demo';
import { parseAssessmentRow } from '../../coach/player/assessmentSync';
import { useClubRoster } from '../../shared/ClubRosterProvider';
import { ci } from '../../shared/ci';
import { markedSessions, nextTraining, ratedText, seasonRunText, statusBreakdown, weekSessions } from '../overview';

type Phase = 'loading' | 'ready';

/** Read, not written: a parent's app never posts a mark, so the tones only describe a coach's decision. */
const STATUS_TONE: Record<AttendanceStatus, string> = {
  present: ci.color.go,
  late: ci.color.warning,
  absent: ci.color.danger,
  excused: ci.color.primary,
};

/**
 * The family's own view of one child: the marks a coach recorded, the season run behind them, the
 * note written for families and the four category averages. Which children appear is not decided
 * here - the players read comes back filtered by the club's row-level policies, so a parent asks as
 * an outsider and still only receives the rows linked to them. Nothing is written to this device's
 * cache: a shared phone should not hold a child's records after the parent closes the tab.
 */
export const ParentOverviewScreen: React.FC<{
  onOpenChild: (player: SquadPlayerRow) => void;
}> = ({ onOpenChild }) => {
  const { user } = useAuth();
  const { membership, previewPlayers, preview, warning, revision } = useClubRoster();
  const teamId = membership?.teamId ?? null;
  // Which children appear is not decided here: for a club account this read has already been
  // narrowed by row-level security to the children linked to this user. Preview has no club behind
  // it, so two sample players stand in for linked children and the chips match what gets loaded.
  const children = useMemo(
    () => (preview ? previewPlayers.slice(0, 2) : previewPlayers),
    [preview, previewPlayers],
  );
  const childrenKey = children.map(child => child.id).join(',');

  const [map, setMap] = useState<AttendanceMap>({});
  const [days, setDays] = useState<TrainingWeekday[]>([]);
  const [assessments, setAssessments] = useState<Record<string, PlayerAssessment | null>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const today = sessionToday();
  const weekStart = mondayOf(today);
  const active = children.find(child => child.id === activeId) ?? children[0] ?? null;

  useEffect(() => {
    let alive = true;
    setLoadError(null);

    if (preview) {
      const seeded: Record<string, PlayerAssessment | null> = {};
      for (const child of children) seeded[child.id] = previewAssessment(child.id);
      if (!alive) return undefined;
      setMap(demoAttendanceSeason(sessionToday()));
      setDays(previewTrainingSettings().days);
      setAssessments(seeded);
      setActiveId(null);
      setPhase('ready');
      return undefined;
    }

    if (!teamId || children.length === 0) {
      setPhase('ready');
      return undefined;
    }

    const playerIds = children.map(child => child.id);
    setPhase('loading');
    void (async () => {
      const [attendanceResult, settingsResult, ...assessmentResults] = await Promise.all([
        supabase
          .from('attendance')
          .select('id, player_id, session_date, status, recorded_at')
          .eq('team_id', teamId)
          .in('player_id', playerIds)
          .eq('session_type', 'practice')
          .is('deleted_at', null),
        supabase.from('team_settings').select('training_days, recorded_at').eq('id', teamId).maybeSingle(),
        ...playerIds.map(playerId =>
          supabase
            .from('player_assessments')
            .select('id, player_id, team_id, scores, coach_notes, recorded_at')
            .eq('team_id', teamId)
            .eq('player_id', playerId)
            .is('deleted_at', null)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ),
      ]);
      if (!alive) return;

      const failures: string[] = [];
      // A failed read keeps the marks already on screen rather than showing an empty week that
      // would look like a child who stayed home; the line below says which part is missing.
      if (attendanceResult.error) {
        failures.push(`Training marks: ${attendanceResult.error.message}`);
      } else {
        const parsed = parseAttendanceRows(attendanceResult.data);
        if (parsed.dropped > 0) failures.push(`${parsed.dropped} attendance row(s) came back unreadable.`);
        setMap(indexAttendance(parsed.rows));
      }

      if (settingsResult.error) failures.push(`Training days: ${settingsResult.error.message}`);
      else setDays(parseTrainingSettings(settingsResult.data).days);

      const nextAssessments: Record<string, PlayerAssessment | null> = {};
      playerIds.forEach((playerId, index) => {
        const name = children[index]?.full_name ?? 'this child';
        const result = assessmentResults[index];
        if (!result || result.error) {
          failures.push(`Ratings for ${name}: ${result?.error?.message ?? 'the club gave no answer.'}`);
          nextAssessments[playerId] = null;
          return;
        }
        const incoming = parseAssessmentRow(result.data);
        nextAssessments[playerId] = incoming?.playerId === playerId ? incoming : null;
        if (incoming && incoming.playerId !== playerId) {
          failures.push(`The rating row returned for ${name} belongs to another player.`);
        }
      });

      if (!alive) return;
      setAssessments(nextAssessments);
      setLoadError(failures.length > 0 ? `${failures.join(' ')} Nothing here has been saved on this device.` : null);
      setPhase('ready');
    })();

    return () => {
      alive = false;
    };
    // `revision` moves when the club roster or the sync queue changes, which is how a mark a coach
    // made after this page opened arrives without a timer.
  }, [childrenKey, preview, revision, reloadKey, teamId]);

  const week = useMemo(
    () => (active ? weekSessions(active.id, map, weekStart, days) : []),
    [active, days, map, weekStart],
  );
  const season = useMemo(() => summariseAttendance(active?.id ?? '', map), [active, map]);
  const assessment = active ? assessments[active.id] ?? null : null;
  const scores = assessment?.scores ?? {};
  const averages = useMemo(() => categoryAverages(scores), [scores]);
  const upcoming = nextTraining(week, today);

  if (!user && !preview) {
    return (
      <View style={styles.center}>
        <Text style={styles.meta}>Sign in to see the children linked to your account.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Family</Text>
          <Text style={styles.headerMeta}>{membership?.teamName ?? 'Your Club'} - read-only</Text>
        </View>
        <Pressable
          onPress={() => setReloadKey(key => key + 1)}
          accessibilityRole="button"
          accessibilityLabel="Reload this child's records from the club"
          style={styles.reload}
        >
          <Text style={styles.reloadLabel}>Reload</Text>
        </Pressable>
      </View>

      {warning ? <Text style={styles.error}>{warning}</Text> : null}

      {children.length > 1 ? (
        <View style={styles.chips}>
          {children.map(child => {
            const selected = active?.id === child.id;
            return (
              <Pressable
                key={child.id}
                onPress={() => setActiveId(child.id)}
                accessibilityRole="tab"
                // `aria-selected` rather than `accessibilityState`: react-native-web 0.21 only reads
                // the aria alias, so the state has to be spelled that way to reach a screen reader.
                aria-selected={selected}
                accessibilityLabel={`${child.full_name}, number ${child.shirt_number}`}
                style={[styles.chip, selected && styles.chipOn]}
              >
                <Text style={[styles.chipLabel, selected && styles.chipLabelOn]}>{child.full_name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {phase === 'loading' ? <ActivityIndicator color={ci.color.primary} accessibilityLabel="Loading your child's records" /> : null}

      {children.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No child is linked to this account yet</Text>
          <Text style={styles.meta}>
            A manager or coach at {membership?.teamName ?? 'your club'} records the link between a parent account and a
            player. The app will not guess it from a name, because children in the same squad share names. Ask the club to
            link this account, then reload.
          </Text>
        </View>
      ) : null}

      {active && phase === 'ready' ? (
        <>
          <View style={styles.card}>
            <View style={styles.childRow}>
              <View style={styles.shirt}>
                <Text style={styles.shirtLabel}>{active.shirt_number}</Text>
              </View>
              <View style={styles.childText}>
                <Text style={styles.childName}>{active.full_name}</Text>
                <Text style={styles.meta}>{active.position_tag ?? 'No position set'}</Text>
              </View>
            </View>
            <Pressable
              onPress={() => onOpenChild(active)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${active.full_name}'s full profile`}
              style={styles.outlineButton}
            >
              <Text style={styles.outlineLabel}>Open full profile</Text>
            </Pressable>
            <Text style={styles.hint}>
              The full profile holds every rating, the radar and game time. Nothing there can be changed from a parent
              account.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>This week</Text>
            <Text style={styles.meta}>{formatWeekRange(weekStart)} - {formatTrainingDays(days)}</Text>
            {days.length === 0 ? (
              <Text style={styles.hint}>No training days are set for this squad, so there is nothing to mark yet.</Text>
            ) : week.length === 0 ? (
              <Text style={styles.hint}>No training session falls in this week.</Text>
            ) : (
              <>
                {week.map(session => (
                  <View key={session.date} style={styles.row}>
                    <Text style={styles.rowLabel}>{formatDay(session.date)}</Text>
                    <Text style={[styles.rowValue, { color: session.status ? STATUS_TONE[session.status] : ci.color.muted }]}>
                      {session.status ? ATTENDANCE_STATUS_LABEL[session.status] : 'Not marked'}
                    </Text>
                  </View>
                ))}
                <Text style={styles.hint}>
                  {markedSessions(week)} of {week.length} session{week.length === 1 ? '' : 's'} marked so far. A mark is the
                  coach's record of who attended.
                </Text>
                {upcoming ? <Text style={styles.next}>Next training: {formatDay(upcoming.date)}</Text> : null}
              </>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>This season</Text>
            <Text style={styles.seasonRun}>{seasonRunText(season)}</Text>
            <Text style={styles.meta}>{statusBreakdown(season)}</Text>
            {season.sessions > 0 ? (
              <Text style={styles.hint}>
                Counted over the {season.sessions} session{season.sessions === 1 ? '' : 's'} a coach marked, not over the
                whole season - sessions nobody marked are left out rather than counted against {active.full_name}.
              </Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Coach feedback</Text>
            <Text style={assessment?.coachNotes ? styles.body : styles.hint}>
              {assessment?.coachNotes || 'No feedback has been shared yet.'}
            </Text>
            {assessment?.recordedAt ? (
              <Text style={styles.meta}>Shared {formatDay(assessment.recordedAt.slice(0, 10))}.</Text>
            ) : null}
            <Text style={styles.hint}>
              This is the note written for your family, and it is the only coach text on this page. Where a club keeps
              staff-only notes about a child, they never appear here.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Development</Text>
            <Text style={styles.meta}>{ratedText(scores)}</Text>
            {CATEGORIES.map(category => {
              const value = averages[category.key];
              return (
                <View key={category.key} style={styles.row}>
                  <Text style={styles.rowLabel}>{category.label}</Text>
                  <Text style={[styles.rowValue, { color: value === null ? ci.color.muted : ci.color.text }]}>
                    {value === null ? 'Not rated' : ratingText(value)}
                  </Text>
                </View>
              );
            })}
            <Text style={styles.hint}>
              {rubricLegend()}. A dash or 'Not rated' means the skill has not been rated, which is not the same as a low
              score. Ratings are a coaching judgement on a 1 to 5 scale: they are not a percentage, and children are not
              ranked against each other.
            </Text>
          </View>

          {loadError ? (
            <View style={styles.card}>
              <Text style={styles.error}>{loadError}</Text>
              <Pressable
                onPress={() => setReloadKey(key => key + 1)}
                accessibilityRole="button"
                accessibilityLabel="Try reading these records again"
                style={styles.retry}
              >
                <Text style={styles.retryLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : null}

          <Text style={styles.footer}>
            {METRICS.length} skills, four groups and the share code are on the full profile. Dates, contact details and
            anything medical stay off these screens.
          </Text>
        </>
      ) : null}
    </ScrollView>
  );
};

const styles = {
  screen: { padding: 16, gap: 12, backgroundColor: ci.color.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: ci.color.background },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1, gap: 2 },
  title: { color: ci.color.text, fontSize: 22, fontWeight: '800' },
  headerMeta: { color: ci.color.muted, fontSize: 13 },
  reload: {
    minHeight: 44,
    minWidth: 72,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: ci.radius.chip,
    backgroundColor: ci.color.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reloadLabel: { color: ci.color.primary, fontSize: 13, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: ci.radius.control,
    borderWidth: 1,
    borderColor: ci.color.border,
    backgroundColor: ci.color.surface,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: ci.color.accent, borderColor: ci.color.accent },
  chipLabel: { color: ci.color.muted, fontSize: 13, fontWeight: '700' },
  chipLabelOn: { color: ci.color.onAccent },
  card: { padding: 14, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 10 },
  cardTitle: { color: ci.color.text, fontSize: 16, fontWeight: '800' },
  childRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shirt: { width: 46, height: 46, borderRadius: 23, backgroundColor: ci.color.accent, alignItems: 'center', justifyContent: 'center' },
  shirtLabel: { color: ci.color.onAccent, fontSize: 17, fontWeight: '800' },
  childText: { flex: 1, gap: 2 },
  childName: { color: ci.color.text, fontSize: 20, fontWeight: '800' },
  outlineButton: {
    minHeight: 44,
    paddingVertical: 11,
    borderRadius: ci.radius.control,
    borderWidth: 1,
    borderColor: ci.color.primary,
    backgroundColor: ci.color.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineLabel: { color: ci.color.primary, fontSize: 13, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 32 },
  rowLabel: { color: ci.color.text, fontSize: 13, flex: 1 },
  rowValue: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums' as const] },
  seasonRun: { color: ci.color.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums' as const] },
  meta: { color: ci.color.muted, fontSize: 13, lineHeight: 19 },
  body: { color: ci.color.text, fontSize: 13, lineHeight: 19 },
  hint: { color: ci.color.muted, fontSize: 12, lineHeight: 17 },
  next: { color: ci.color.go, fontSize: 13, fontWeight: '700' },
  error: { color: ci.color.danger, fontSize: 13, lineHeight: 19 },
  retry: {
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: ci.radius.chip,
    backgroundColor: ci.color.raised,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  retryLabel: { color: ci.color.primary, fontSize: 14, fontWeight: '700' },
  footer: { color: ci.color.muted, fontSize: 11, lineHeight: 16, paddingBottom: 12 },
} as const;
