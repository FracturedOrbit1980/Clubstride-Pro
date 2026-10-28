import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { useSyncQueue } from '../../../core/sync';
import { supabase } from '../../../core/supabaseClient';
import { cacheKey, readCache, writeCache } from '../attendance/cache';
import type { SquadPlayerRow } from '../attendance/squad';
import { formatDay } from '../attendance/week';
import {
  CATEGORIES,
  METRICS_BY_CATEGORY,
  RATING_MAX,
  RATING_OPTIONS,
  categoryAverages,
  overallAverage,
  ratingText,
  setScore,
  type MetricKey,
  type PlayerAssessment,
  type Scores,
} from '../player/assessment';
import {
  assessmentRowId,
  parseAssessmentRow,
  pickNewerAssessment,
  queueAssessment,
  toAssessmentRow,
} from '../player/assessmentSync';
import {
  buildMatchLog,
  entryMinutesText,
  formatPercentage,
  gameTimeText,
  mergeMatchLog,
  parseLineupRows,
  parseMatchRows,
  summariseMinutes,
  type PlayerMatchEntry,
} from '../player/minutes';
import { RadarChart } from '../player/RadarChart';
import { buildPlayerReportPdf, playerReportFileName } from '../player/report';
import {
  generateShareCode,
  shareProfileMessage,
  shareProfileWebLink,
} from '../player/shareCode';
import { demoAssessment, demoMatchLog, previewShareCode } from '../../shared/demo';
import { useClubRoster } from '../../shared/ClubRosterProvider';
import { ci } from '../../shared/ci';
import { savePdf } from '../../shared/pdfExport';

type Phase = 'loading' | 'ready';

const fillWidth = (value: number | null): `${number}%` =>
  `${Math.round(((value ?? 0) / RATING_MAX) * 100)}%`;

const latestMatches = 6;

/**
 * One player's report: game time summed from completed matches, the 17 ratings behind a
 * four-axis radar, the coach's note, and the code a family can open it with. Reads the cache
 * first, then the club, like the register; a rating saved here is queued before it is cached,
 * so it survives leaving the ground with no signal.
 */
export const PlayerProfileScreen: React.FC<{
  player: SquadPlayerRow;
  onBack: () => void;
}> = ({ player, onBack }) => {
  const { user, isStaff } = useAuth();
  const { queue } = useSyncQueue();
  const { membership, local, preview, warning, matchLog, matchRevision } = useClubRoster();
  const teamId = membership?.teamId ?? null;
  const installationId = local?.installationId ?? null;
  const userId = preview ? null : user?.id ?? null;
  // Assessments are scoped to the player for both device teams and club teams.
  const assessmentUserId = installationId ? `lite-${installationId}` : userId;
  const localAssessmentKey = teamId && assessmentUserId
    ? cacheKey('assessment', assessmentUserId, `${teamId}.${player.id}`)
    : null;
  const canEdit = !(preview && warning) && (preview || (teamId !== null && isStaff(teamId)));

  const [phase, setPhase] = useState<Phase>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [scores, setScores] = useState<Scores>({});
  const [notes, setNotes] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [entries, setEntries] = useState<PlayerMatchEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const [shareCode, setShareCode] = useState<string | null>(null);
  const [shareRevoked, setShareRevoked] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const entriesRef = useRef<PlayerMatchEntry[]>([]);
  const assessmentRef = useRef<PlayerAssessment | null>(null);
  const dirtyRef = useRef(false);
  // Only matchRevision belongs in the load effect's dependencies: the provider hands out a new
  // function on every render, and depending on that would re-run every club read on each poll.
  const matchLogRef = useRef(matchLog);
  matchLogRef.current = matchLog;

  const applyAssessment = useCallback((assessment: PlayerAssessment | null): void => {
    assessmentRef.current = assessment;
    dirtyRef.current = false;
    setScores(assessment?.scores ?? {});
    setNotes(assessment?.coachNotes ?? '');
    setSavedAt(assessment?.recordedAt ?? null);
    setDirty(false);
  }, []);

  useEffect(() => {
    if (preview && warning) {
      applyAssessment(null);
      entriesRef.current = [];
      setEntries([]);
      setShareCode(null);
      setPhase('ready');
      return;
    }
    if (preview && localAssessmentKey) {
      let active = true;
      if (!dirtyRef.current) applyAssessment(null);
      // A device team's game time is the history Lite itself recorded for the same squad.
      const sharedLog = matchLogRef.current(player.id);
      entriesRef.current = sharedLog;
      setEntries(sharedLog);
      setShareCode(null);
      setShareRevoked(false);
      setLoadError(null);
      setPhase('loading');
      void readCache(localAssessmentKey).then(result => {
        if (!active) return;
        const assessment = parseAssessmentRow(result.raw);
        if (!dirtyRef.current) applyAssessment(assessment?.playerId === player.id ? assessment : null);
        setLoadError(result.warning ?? (result.raw !== null && assessment?.playerId !== player.id ? 'The saved Lite assessment could not be read.' : null));
        setPhase('ready');
      });
      return () => { active = false; };
    }
    if (preview) {
      applyAssessment(local ? null : demoAssessment(player.id));
      entriesRef.current = local ? [] : demoMatchLog(player.id);
      setEntries(entriesRef.current);
      setShareCode(local ? null : previewShareCode(player.id));
      setShareRevoked(false);
      setPhase('ready');
      return;
    }

    if (!teamId || !userId || !localAssessmentKey) {
      setPhase('ready');
      return;
    }

    let active = true;
    setPhase('loading');
    setLoadError(null);

    const assessmentKey = localAssessmentKey;
    const matchesKey = cacheKey('matches', userId, teamId);
    const lineupKey = cacheKey('lineup', userId, teamId);

    void (async () => {
      const [assessmentRead, matchesRead, lineupRead] = await Promise.all([
        readCache(assessmentKey),
        readCache(matchesKey),
        readCache(lineupKey),
      ]);
      if (!active) return;

      const notesForCoach: string[] = [];
      for (const warning of [assessmentRead.warning, matchesRead.warning, lineupRead.warning]) {
        if (warning) notesForCoach.push(warning);
      }

      const cachedAssessment = parseAssessmentRow(assessmentRead.raw);
      const cachedMatches = parseMatchRows(matchesRead.raw);
      const cachedLineup = parseLineupRows(lineupRead.raw);

      if (assessmentRead.raw !== null && cachedAssessment?.playerId !== player.id) {
        notesForCoach.push('The saved assessment does not belong to this player or could not be read.');
      }
      if (!dirtyRef.current) applyAssessment(pickNewerAssessment(assessmentRef.current, cachedAssessment?.playerId === player.id ? cachedAssessment : null));
      // Shared history first: it holds the matches this phone recorded that have not reached the
      // club database yet, and mergeMatchLog keeps one row per match by its version.
      entriesRef.current = mergeMatchLog(buildMatchLog(player.id, cachedMatches.rows, cachedLineup.rows), matchLogRef.current(player.id));
      setEntries(entriesRef.current);
      setPhase('ready');

      if (cachedMatches.dropped > 0) notesForCoach.push(`${cachedMatches.dropped} saved match row(s) could not be read.`);
      if (notesForCoach.length > 0) setLoadError(notesForCoach.join(' '));

      const [assessmentResult, matchesResult, lineupResult] = await Promise.all([
        supabase
          .from('player_assessments')
          .select('id, player_id, team_id, scores, coach_notes, recorded_at')
          .eq('team_id', teamId)
          .eq('player_id', player.id)
          .is('deleted_at', null)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('matches')
          .select('id, title, opponent_name, match_date, status, duration_seconds, recorded_at, deleted_at')
          .eq('team_id', teamId)
          .is('deleted_at', null),
        supabase
          .from('match_players')
          .select('match_id, player_id, listed_as, recorded_seconds')
          .eq('player_id', player.id),
      ]);
      if (!active) return;

      const failures: string[] = [...notesForCoach];

      if (assessmentResult.error) {
        failures.push(`Ratings: showing the copy saved on this phone. The club copy could not be read: ${assessmentResult.error.message}`);
      } else {
        const incoming = parseAssessmentRow(assessmentResult.data);
        const winner = pickNewerAssessment(assessmentRef.current, incoming?.playerId === player.id ? incoming : null);
        if (incoming && incoming.playerId !== player.id) failures.push('The club assessment does not belong to this player.');
        if (!dirtyRef.current && winner && winner !== assessmentRef.current) applyAssessment(winner);
        if (winner) {
          const warning = await writeCache(assessmentKey, toAssessmentRow(winner, teamId));
          if (warning) failures.push(warning);
        }
      }

      if (matchesResult.error) {
        failures.push(
          entriesRef.current.length > 0
            ? `Game time: showing the copy saved on this phone. The club copy could not be read: ${matchesResult.error.message}`
            : `Game time: ${matchesResult.error.message}`,
        );
      } else if (!lineupResult.error) {
        const serverMatches = parseMatchRows(matchesResult.data);
        const serverLineup = parseLineupRows(lineupResult.data);
        entriesRef.current = mergeMatchLog(
          entriesRef.current,
          buildMatchLog(player.id, serverMatches.rows, serverLineup.rows),
        );
        setEntries(entriesRef.current);
        if (serverMatches.dropped > 0) failures.push(`${serverMatches.dropped} match row(s) came back unreadable.`);
        // Seeded only while the phone has nothing: after this the minutes screen owns the
        // cache, and overwriting it with a server read could drop an edit not yet synced.
        if (cachedMatches.rows.length === 0) {
          const warning = await writeCache(matchesKey, serverMatches.rows);
          if (warning) failures.push(warning);
        }
        if (cachedLineup.rows.length === 0) {
          const warning = await writeCache(lineupKey, serverLineup.rows);
          if (warning) failures.push(warning);
        }
      } else {
        failures.push(`Game time: ${lineupResult.error.message}`);
      }

      if (active) setLoadError(failures.length > 0 ? failures.join(' ') : null);
    })();

    return () => {
      active = false;
    };
  }, [applyAssessment, local, localAssessmentKey, matchRevision, player.id, preview, reloadKey, teamId, userId, warning]);

  // The per-player cache is shared by browser tabs, but never replaces an unsaved edit.
  useEffect(() => {
    if (!localAssessmentKey || Platform.OS !== 'web' || typeof window === 'undefined') return;
    let active = true;
    const refresh = (): void => {
      if (dirtyRef.current) return;
      void readCache(localAssessmentKey).then(result => {
        if (!active || dirtyRef.current) return;
        const assessment = parseAssessmentRow(result.raw);
        if (assessment?.playerId === player.id) {
          applyAssessment(pickNewerAssessment(assessmentRef.current, assessment));
        }
        if (result.warning) setLoadError(result.warning);
      });
    };
    const changed = (event: StorageEvent): void => {
      if (event.key === localAssessmentKey || event.key === null) refresh();
    };
    window.addEventListener('storage', changed);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('storage', changed);
      window.removeEventListener('focus', refresh);
    };
  }, [applyAssessment, dirty, localAssessmentKey, player.id]);

  // --- the share code --------------------------------------------------------------------

  useEffect(() => {
    if (preview || !canEdit) return;
    let active = true;
    setShareError(null);
    void supabase
      .from('player_share_codes')
      .select('code, revoked_at')
      .eq('player_id', player.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setShareError(`The share code could not be read: ${error.message}`);
          return;
        }
        const row = data as { code?: unknown; revoked_at?: unknown } | null;
        if (row && typeof row.code === 'string') {
          setShareCode(row.code);
          setShareRevoked(row.revoked_at !== null && row.revoked_at !== undefined);
        } else {
          setShareCode(null);
          setShareRevoked(false);
        }
      });
    return () => {
      active = false;
    };
  }, [canEdit, player.id, preview, reloadKey]);

  const averages = useMemo(() => categoryAverages(scores), [scores]);
  const overall = useMemo(() => overallAverage(scores), [scores]);
  const summary = useMemo(() => summariseMinutes(entries), [entries]);

  const rate = (key: MetricKey, value: number): void => {
    if (!canEdit) return;
    dirtyRef.current = true;
    setScores(current => setScore(current, key, value));
    setDirty(true);
    setSaveError(null);
  };

  const saveFeedback = (): void => {
    if (!canEdit) return;
    const recordedAt = new Date().toISOString();
    const next: PlayerAssessment = {
      id: assessmentRowId(player.id),
      playerId: player.id,
      scores,
      coachNotes: notes.trim() || null,
      recordedAt,
    };
    setSaveError(null);
    setSaveNotice(null);

    if (preview && localAssessmentKey && teamId) {
      applyAssessment(next);
      void writeCache(localAssessmentKey, toAssessmentRow(next, teamId)).then(warning => {
        if (warning) {
          setSaveError(warning);
          dirtyRef.current = true;
          setDirty(true);
        } else {
          setSaveNotice('Feedback saved on this device.');
        }
      });
      return;
    }
    if (preview) {
      applyAssessment(next);
      setSaveNotice('Preview: saved on this screen only.');
      return;
    }
    if (!teamId || !userId || !localAssessmentKey) {
      setSaveError('This account is not attached to a squad, so the rating was not saved.');
      return;
    }
    if (!queueAssessment(queue, teamId, next)) {
      setSaveError('The rating was not saved: the sync queue is not attached to an account. Sign in again, then save.');
      return;
    }
    applyAssessment(next);
    setSaveNotice('Saved on this phone. It syncs when the connection returns.');
    void writeCache(localAssessmentKey, toAssessmentRow(next, teamId)).then(warning => {
      if (warning) setSaveNotice(warning);
    });
  };

  const writeShareCode = async (): Promise<void> => {
    if (preview || !teamId || !canEdit || shareBusy) return;
    setShareBusy(true);
    setShareError(null);
    setCopied(false);
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const code = generateShareCode();
        // Upsert on the player: creating, rotating and re-sharing after a revoke are one path,
        // and a duplicate-key failure can only mean the code itself was already issued.
        const { error } = await supabase
          .from('player_share_codes')
          .upsert({ player_id: player.id, team_id: teamId, code, revoked_at: null }, { onConflict: 'player_id' });
        if (!error) {
          setShareCode(code);
          setShareRevoked(false);
          return;
        }
        if (error.code !== '23505') {
          setShareError(`Could not create a code: ${error.message}`);
          return;
        }
      }
      setShareError('Three generated codes were already taken. Try again in a moment.');
    } catch (error) {
      setShareError(`Could not create a code: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setShareBusy(false);
    }
  };

  const revokeShareCode = async (): Promise<void> => {
    if (preview || !canEdit || shareBusy || !shareCode) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const { error } = await supabase
        .from('player_share_codes')
        .update({ revoked_at: new Date().toISOString() })
        .eq('player_id', player.id);
      if (error) {
        setShareError(`The code was not revoked: ${error.message}`);
        return;
      }
      setShareRevoked(true);
      setCopied(false);
    } catch (error) {
      setShareError(`The code was not revoked: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setShareBusy(false);
    }
  };

  const copyInvite = async (): Promise<void> => {
    if (!shareCode) return;
    setShareError(null);
    setCopied(false);
    const message = shareProfileMessage(player.full_name, shareCode);
    try {
      if (Platform.OS === 'web') {
        const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
        if (!clipboard) {
          setShareError('This browser will not copy for the app. Select the link above and copy it.');
          return;
        }
        await clipboard.writeText(message);
        setCopied(true);
      } else {
        await Share.share({ message });
      }
    } catch (error) {
      setShareError(`Could not share the invite: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const exportReport = async (): Promise<void> => {
    if (!canEdit || exporting) return;
    setExportError(null);
    setExporting(true);
    try {
      const generatedAt = new Date();
      const bytes = buildPlayerReportPdf({
        teamName: membership?.teamName ?? 'Clubstride Pro',
        playerName: player.full_name,
        shirtNumber: player.shirt_number,
        position: player.position_tag,
        scores,
        coachNotes: notes.trim() || null,
        minutes: summary,
        shareCode: !installationId && shareCode && !shareRevoked ? shareCode : null,
        generatedAt,
      });
      await savePdf(bytes, playerReportFileName(player.full_name, generatedAt), 'Player report');
    } catch (error) {
      setExportError(`Could not create the PDF: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExporting(false);
    }
  };

  const position = player.position_tag ?? 'No position set';
  const olderMatches = entries.length > latestMatches ? entries.length - latestMatches : 0;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to squad" style={styles.back}>
          <Text style={styles.backLabel}>‹ Squad</Text>
        </Pressable>
        <Text style={styles.headerMeta}>{membership?.teamName ?? 'Clubstride Pro'}</Text>
      </View>

      <View style={styles.playerHead}>
        <View style={styles.shirt}>
          <Text style={styles.shirtLabel}>{player.shirt_number}</Text>
        </View>
        <View style={styles.playerText}>
          <Text style={styles.title}>{player.full_name}</Text>
          <Text style={styles.meta}>{position}</Text>
        </View>
        <View style={styles.overall}>
          <Text style={styles.overallValue}>{ratingText(overall)}</Text>
          <Text style={styles.overallLabel}>overall</Text>
        </View>
      </View>

      {canEdit ? (
        <View style={styles.exportCard}>
          <Pressable
            onPress={() => void exportReport()}
            disabled={exporting || phase === 'loading'}
            accessibilityRole="button"
            accessibilityLabel={`Export ${player.full_name}'s report as a PDF`}
            style={[styles.exportButton, (exporting || phase === 'loading') && styles.primaryOff]}
          >
            <Text style={styles.exportLabel}>{exporting ? 'Preparing report...' : 'Export report PDF'}</Text>
          </Pressable>
          <Text style={styles.exportHint}>
            {installationId ? 'One page with device ratings and notes. Online sharing requires an authorized matching club team.' : 'One page with the ratings, game time and share code - send it to the family.'}
          </Text>
          {exportError ? <Text style={styles.error}>{exportError}</Text> : null}
        </View>
      ) : null}

      {warning ? <Text style={styles.error}>{warning}</Text> : null}
      {phase === 'loading' ? <ActivityIndicator color={ci.color.primary} /> : null}

      {loadError ? (
        <View style={styles.warningCard}>
          <Text style={styles.error}>{loadError}</Text>
          <Pressable style={styles.retry} onPress={() => setReloadKey(key => key + 1)}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'ready' ? (
        <>
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Game time</Text>
              <Text style={styles.bigValue}>{formatPercentage(summary.percentage)}</Text>
            </View>
            <Text style={styles.meta}>{gameTimeText(summary)}</Text>
            {entries.length > 0 ? (
              <View style={styles.matchList}>
                {entries.slice(0, latestMatches).map(entry => (
                  <View key={entry.matchId} style={styles.matchRow}>
                    <View style={styles.matchText}>
                      <Text style={styles.matchName} numberOfLines={1}>
                        {entry.opponentName || entry.title}
                      </Text>
                      <Text style={styles.matchDate}>{formatDay(entry.matchDate)}</Text>
                    </View>
                    <Text style={styles.matchMinutes}>{entryMinutesText(entry)}</Text>
                  </View>
                ))}
                {olderMatches > 0 ? (
                  <Text style={styles.hint}>{olderMatches} earlier completed match(es) are counted in the total.</Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.hint}>
                {local
                  ? 'No completed match for this squad yet. Finish a match in Lite and its game time appears here.'
                  : 'Nothing counted yet. Game time adds up every completed match, including the ones this player was not picked for.'}
              </Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rating profile</Text>
            <View style={styles.chart}>
              <RadarChart
                values={CATEGORIES.map(category => averages[category.key])}
                labels={CATEGORIES.map(category => category.label)}
              />
            </View>
            <View style={styles.categoryGrid}>
              {CATEGORIES.map(category => (
                <View key={category.key} style={styles.categoryCell}>
                  <Text style={styles.categoryLabel}>{category.label}</Text>
                  <Text style={styles.categoryValue}>{ratingText(averages[category.key])}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.hint}>
              Each axis is the average of its metrics, from 1 at the centre to 5 on the outer ring.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ratings</Text>
            <Text style={styles.hint}>
              {canEdit ? 'Tap a score from 1 to 5, in half steps.' : 'Only a coach or manager can change these.'}
            </Text>
            {METRICS_BY_CATEGORY.map(group => (
              <View key={group.key} style={styles.group}>
                <View style={styles.groupHead}>
                  <Text style={styles.groupTitle}>{group.label}</Text>
                  <Text style={styles.groupAverage}>{ratingText(averages[group.key])}</Text>
                </View>
                {group.metrics.map(metric => {
                  const value = scores[metric.key] ?? null;
                  return (
                    <View key={metric.key} style={styles.metric}>
                      <View style={styles.metricHead}>
                        <Text style={styles.metricLabel}>{metric.label}</Text>
                        <Text style={styles.metricValue}>{ratingText(value)}</Text>
                      </View>
                      <View style={styles.metricTrack}>
                        <View style={[styles.metricFill, { width: fillWidth(value) }]} />
                      </View>
                      {canEdit ? (
                        <View style={styles.scaleRow}>
                          {RATING_OPTIONS.map(option => {
                            const selected = value === option;
                            return (
                              <Pressable
                                key={option}
                                onPress={() => rate(metric.key, option)}
                                accessibilityRole="button"
                                accessibilityLabel={`${metric.label}: ${option}`}
                                accessibilityState={{ selected }}
                                style={[styles.scaleCell, selected && styles.scaleCellOn]}
                              >
                                <Text style={[styles.scaleLabel, selected && styles.scaleLabelOn]}>{option}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Coach note</Text>
            {canEdit ? (
              <>
                <TextInput
                  value={notes}
                  onChangeText={text => {
                    dirtyRef.current = true;
                    setNotes(text);
                    setDirty(true);
                    setSaveNotice(null);
                  }}
                  placeholder="What is working, and what comes next?"
                  placeholderTextColor={ci.color.muted}
                  multiline
                  maxLength={2000}
                  style={styles.notesInput}
                />
                <Text style={styles.hint}>
                  {dirty
                    ? 'Unsaved changes.'
                    : savedAt
                      ? `Saved ${formatDay(savedAt.slice(0, 10))}.`
                      : 'Not saved yet.'}{' '}
                  {installationId ? 'Saved on this device only.' : 'Saves on this phone first, then syncs.'}
                </Text>
                {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
                {saveNotice ? <Text style={styles.notice}>{saveNotice}</Text> : null}
                <Pressable
                  onPress={saveFeedback}
                  disabled={!dirty}
                  accessibilityRole="button"
                  style={[styles.primary, !dirty && styles.primaryOff]}
                >
                  <Text style={styles.primaryLabel}>Save feedback</Text>
                </Pressable>
              </>
            ) : (
              <Text style={notes ? styles.notesText : styles.hint}>
                {notes || 'No coach note yet.'}
              </Text>
            )}
          </View>

          {canEdit && !installationId ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Share with family</Text>
              <Text style={styles.hint}>
                A code and link open this profile without an account. Treat the code like the report itself: anyone
                holding it can read this player's ratings.
              </Text>
              {shareError ? <Text style={styles.error}>{shareError}</Text> : null}
              {shareCode && !shareRevoked ? (
                <>
                  <Text style={styles.code}>{shareCode}</Text>
                  <Text style={styles.linkText} selectable>
                    {shareProfileWebLink(shareCode)}
                  </Text>
                  <View style={styles.buttonRow}>
                    <Pressable
                      onPress={() => void copyInvite()}
                      accessibilityRole="button"
                      style={[styles.secondary, styles.flexButton]}
                    >
                      <Text style={styles.secondaryLabel}>Copy invite</Text>
                    </Pressable>
                    {!preview ? (
                      <Pressable
                        onPress={() => void writeShareCode()}
                        disabled={shareBusy}
                        accessibilityRole="button"
                        style={[styles.secondary, styles.flexButton]}
                      >
                        <Text style={styles.secondaryLabel}>{shareBusy ? 'Working...' : 'New code'}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {!preview ? (
                    <Pressable onPress={() => void revokeShareCode()} disabled={shareBusy} accessibilityRole="button">
                      <Text style={styles.dangerLink}>Revoke this code</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.hint}>
                    {shareRevoked
                      ? 'This code was revoked. Create a new one to share again.'
                      : 'No code has been created for this player yet.'}
                  </Text>
                  {!preview ? (
                    <Pressable
                      onPress={() => void writeShareCode()}
                      disabled={shareBusy}
                      accessibilityRole="button"
                      style={[styles.primary, shareBusy && styles.primaryOff]}
                    >
                      <Text style={styles.primaryLabel}>{shareBusy ? 'Working...' : 'Create code'}</Text>
                    </Pressable>
                  ) : null}
                </>
              )}
              {preview ? (
                <Text style={styles.hint}>
                  Preview code: {previewShareCode(player.id)} - the bundled sample profile. Real codes need a sign-in.
                </Text>
              ) : null}
              {copied ? <Text style={styles.notice}>Invite copied.</Text> : null}
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
};

const styles = {
  screen: { padding: 16, gap: 12, backgroundColor: ci.color.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  back: { paddingVertical: 6, paddingRight: 10 },
  backLabel: { color: ci.color.primary, fontSize: 14, fontWeight: '800' },
  headerMeta: { color: ci.color.muted, fontSize: 12 },
  playerHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shirt: { width: 46, height: 46, borderRadius: 23, backgroundColor: ci.color.accent, alignItems: 'center', justifyContent: 'center' },
  shirtLabel: { color: ci.color.onAccent, fontSize: 17, fontWeight: '800' },
  playerText: { flex: 1, gap: 2 },
  title: { color: ci.color.text, fontSize: 22, fontWeight: '800' },
  meta: { color: ci.color.muted, fontSize: 13, lineHeight: 19 },
  overall: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: ci.radius.control,
    backgroundColor: ci.color.surface,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: ci.color.border,
  },
  overallValue: { color: ci.color.accent, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums' as const] },
  overallLabel: { color: ci.color.muted, fontSize: 10, fontWeight: '700' },
  warningCard: { padding: 12, borderRadius: ci.radius.control, backgroundColor: ci.color.surface, gap: 8 },
  exportCard: { padding: 12, borderRadius: ci.radius.control, backgroundColor: ci.color.surface, gap: 8 },
  exportButton: {
    paddingVertical: 11,
    borderRadius: ci.radius.control,
    borderWidth: 1,
    borderColor: ci.color.primary,
    backgroundColor: ci.color.background,
    alignItems: 'center',
  },
  exportLabel: { color: ci.color.primary, fontSize: 13, fontWeight: '800' },
  exportHint: { color: ci.color.muted, fontSize: 11, lineHeight: 16 },  error: { color: ci.color.danger, fontSize: 13, lineHeight: 19 },
  notice: { color: ci.color.go, fontSize: 13, lineHeight: 19 },
  retry: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised, alignSelf: 'flex-start' },
  retryLabel: { color: ci.color.primary, fontSize: 14, fontWeight: '700' },
  card: { padding: 14, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  cardTitle: { color: ci.color.text, fontSize: 16, fontWeight: '800' },
  bigValue: { color: ci.color.accent, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums' as const] },
  hint: { color: ci.color.muted, fontSize: 12, lineHeight: 17 },
  matchList: { gap: 8 },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  matchText: { flex: 1, gap: 1 },
  matchName: { color: ci.color.text, fontSize: 13, fontWeight: '700' },
  matchDate: { color: ci.color.muted, fontSize: 11 },
  matchMinutes: { color: ci.color.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums' as const] },
  chart: { alignItems: 'center' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryCell: {
    flexGrow: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: ci.radius.chip,
    backgroundColor: ci.color.background,
  },
  categoryLabel: { color: ci.color.muted, fontSize: 12, fontWeight: '700' },
  categoryValue: { color: ci.color.text, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums' as const] },
  group: { gap: 10, paddingTop: 6 },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupTitle: { color: ci.color.primary, fontSize: 13, fontWeight: '800', letterSpacing: 0.3, textTransform: 'uppercase' },
  groupAverage: { color: ci.color.accent, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums' as const] },
  metric: { gap: 6 },
  metricHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  metricLabel: { color: ci.color.text, fontSize: 13, flex: 1 },
  metricValue: { color: ci.color.muted, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums' as const] },
  metricTrack: { height: 4, borderRadius: 2, backgroundColor: ci.color.background, overflow: 'hidden' },
  metricFill: { height: 4, borderRadius: 2, backgroundColor: ci.color.accent },
  scaleRow: { flexDirection: 'row', gap: 3 },
  scaleCell: {
    flex: 1,
    minHeight: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ci.color.background,
    borderWidth: 1,
    borderColor: ci.color.border,
  },
  scaleCellOn: { backgroundColor: ci.color.accent, borderColor: ci.color.accent },
  scaleLabel: { color: ci.color.muted, fontSize: 9, fontWeight: '700', fontVariant: ['tabular-nums' as const] },
  scaleLabelOn: { color: ci.color.onAccent },
  notesInput: {
    minHeight: 88,
    padding: 10,
    borderRadius: ci.radius.control,
    backgroundColor: ci.color.background,
    borderWidth: 1,
    borderColor: ci.color.borderInput,
    color: ci.color.text,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  notesText: { color: ci.color.text, fontSize: 13, lineHeight: 19 },
  primary: { paddingVertical: 12, borderRadius: ci.radius.control, backgroundColor: ci.color.accent, alignItems: 'center' },
  primaryOff: { opacity: 0.5 },
  primaryLabel: { color: ci.color.onAccent, fontSize: 14, fontWeight: '800' },
  secondary: { paddingVertical: 11, borderRadius: ci.radius.control, backgroundColor: ci.color.raised, alignItems: 'center' },
  secondaryLabel: { color: ci.color.text, fontSize: 13, fontWeight: '700' },
  buttonRow: { flexDirection: 'row', gap: 8 },
  flexButton: { flex: 1 },
  code: {
    color: ci.color.text,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 5,
    textAlign: 'center',
    paddingVertical: 8,
    borderRadius: ci.radius.control,
    backgroundColor: ci.color.background,
    fontVariant: ['tabular-nums' as const],
  },
  linkText: { color: ci.color.primary, fontSize: 12, lineHeight: 17 },
  dangerLink: { color: ci.color.danger, fontSize: 12, fontWeight: '700', paddingVertical: 4 },
} as const;
