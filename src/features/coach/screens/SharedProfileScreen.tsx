import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { supabase } from '../../../core/supabaseClient';
import { CATEGORIES, METRICS_BY_CATEGORY, RATING_MAX, categoryAverages, overallAverage, ratingText } from '../player/assessment';
import { entryMinutesText, formatPercentage, gameTimeText, summariseMinutes, type PlayerMatchEntry } from '../player/minutes';
import { formatDay } from '../attendance/week';
import { RadarChart } from '../player/RadarChart';
import { parseSharedProfile, type SharedProfile } from '../player/sharedProfile';
import { isShareCode, normaliseShareCode } from '../player/shareCode';
import { DEMO_MEMBERSHIP, demoMatchLog, previewAssessment, previewSharedPlayer } from '../../shared/demo';
import { BrandLockup } from '../../shared/components/BrandLockup';
import { ci } from '../../shared/ci';

type Phase = 'loading' | 'ready' | 'missing' | 'error';

const latestMatches = 6;

const fillWidth = (value: number | null): `${number}%` =>
  `${Math.round(((value ?? 0) / RATING_MAX) * 100)}%`;

const demoProfile = (code: string): SharedProfile | null => {
  const player = previewSharedPlayer(code);
  if (!player) return null;
  // The saved preview assessment, not the seed: a note typed on the profile is what this page
  // has to show, the same way the club's copy reaches a real share code.
  const assessment = previewAssessment(player.id);
  const entries = demoMatchLog(player.id);
  return {
    player: {
      id: player.id,
      fullName: player.full_name,
      shirtNumber: player.shirt_number,
      position: player.position_tag,
      teamName: DEMO_MEMBERSHIP.teamName,
    },
    scores: assessment.scores,
    coachNotes: assessment.coachNotes,
    recordedAt: assessment.recordedAt,
    entries,
    summary: summariseMinutes(entries),
    generatedAt: new Date().toISOString(),
  };
};

/**
 * The page a share code opens. Signed out on purpose: the code is the only credential, and the
 * lookup runs through a SECURITY DEFINER function that returns one child and nothing else.
 * While the app itself is signed out (preview), the bundled PLAYER24-style codes open the sample
 * profile so the page can be shown end to end without a club account.
 */
export const SharedProfileScreen: React.FC<{
  code: string;
  onClose?: (() => void) | undefined;
  onOpenCode?: ((code: string) => void) | undefined;
}> = ({ code, onClose, onOpenCode }) => {
  const { preview } = useAuth();
  const [current, setCurrent] = useState(() => normaliseShareCode(code));
  const [phase, setPhase] = useState<Phase>('loading');
  const [profile, setProfile] = useState<SharedProfile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [entry, setEntry] = useState('');
  const [entryError, setEntryError] = useState<string | null>(null);

  useEffect(() => {
    setCurrent(normaliseShareCode(code));
  }, [code]);

  useEffect(() => {
    const sample = preview ? demoProfile(current) : null;
    if (sample) {
      setProfile(sample);
      setPhase('ready');
      setMessage(null);
      setNotice(null);
      return;
    }

    let active = true;
    setPhase('loading');
    setMessage(null);

    void supabase
      .rpc('player_profile_by_code', { p_code: current })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setPhase('error');
          setMessage(error.message);
          return;
        }
        const parsed = parseSharedProfile(data);
        if (!parsed.profile) {
          setProfile(null);
          setPhase('missing');
          return;
        }
        setProfile(parsed.profile);
        setNotice(parsed.dropped > 0 ? `${parsed.dropped} match row(s) could not be read.` : null);
        setPhase('ready');
      });

    return () => {
      active = false;
    };
  }, [current, preview, reloadKey]);

  const averages = useMemo(() => categoryAverages(profile?.scores ?? {}), [profile]);
  const overall = useMemo(() => overallAverage(profile?.scores ?? {}), [profile]);
  const entries: readonly PlayerMatchEntry[] = profile?.entries ?? [];
  const olderMatches = entries.length > latestMatches ? entries.length - latestMatches : 0;

  const openCode = (value: string): void => {
    const next = normaliseShareCode(value);
    if (!isShareCode(next)) {
      setEntryError('A code is eight characters, without I, O, 0 or 1.');
      return;
    }
    setEntryError(null);
    setEntry('');
    setCurrent(next);
    onOpenCode?.(next);
  };

  const codeForm = (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Open another report</Text>
      <Text style={styles.hint}>Type the eight-character code printed on the player's report.</Text>
      <TextInput
        value={entry}
        onChangeText={value => {
          setEntry(value);
          setEntryError(null);
        }}
        onSubmitEditing={() => openCode(entry)}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="ABCD2345"
        placeholderTextColor={ci.color.muted}
        maxLength={16}
        style={styles.codeInput}
        accessibilityLabel="Player report code"
      />
      {entryError ? <Text style={styles.error}>{entryError}</Text> : null}
      <Pressable
        onPress={() => openCode(entry)}
        accessibilityRole="button"
        accessibilityLabel="Open this report code"
        style={styles.primary}
      >
        <Text style={styles.primaryLabel}>Open report</Text>
      </Pressable>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <BrandLockup size={22} />
        {onClose ? (
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the shared report" style={styles.close}>
            <Text style={styles.closeLabel}>Close</Text>
          </Pressable>
        ) : null}
      </View>

      {phase === 'loading' ? (
        <View style={styles.loading}>
          <ActivityIndicator color={ci.color.primary} />
          <Text style={styles.hint}>Opening the report...</Text>
        </View>
      ) : null}

      {phase === 'missing' ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>That code does not open a report</Text>
          <Text style={styles.hint}>
            Codes are eight characters and avoid I, O, 0 and 1 so they are easy to read off the printed report. A coach
            can issue a new code at any time, which switches the old one off.
          </Text>
          <Text style={styles.mono}>{current || '-'}</Text>
        </View>
      ) : null}

      {phase === 'error' ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>The report could not be opened</Text>
          <Text style={styles.hint}>This is a connection or club-server problem, not a wrong code.</Text>
          <Text style={styles.error}>{message}</Text>
          <Pressable
            onPress={() => setReloadKey(key => key + 1)}
            accessibilityRole="button"
            style={styles.secondary}
          >
            <Text style={styles.secondaryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'missing' || phase === 'error' ? codeForm : null}

      {phase === 'ready' && profile ? (
        <>
          <View style={styles.playerHead}>
            <View style={styles.shirt}>
              <Text style={styles.shirtLabel}>{profile.player.shirtNumber}</Text>
            </View>
            <View style={styles.playerText}>
              <Text style={styles.title}>{profile.player.fullName}</Text>
              <Text style={styles.meta}>
                {profile.player.position ?? 'No position set'} - {profile.player.teamName}
              </Text>
            </View>
            <View style={styles.overall}>
              <Text style={styles.overallValue}>{ratingText(overall)}</Text>
              <Text style={styles.overallLabel}>overall</Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Game time</Text>
              <Text style={styles.bigValue}>{formatPercentage(profile.summary.percentage)}</Text>
            </View>
            <Text style={styles.hint}>{gameTimeText(profile.summary)}</Text>
            {entries.length > 0 ? (
              <View style={styles.matchList}>
                {entries.slice(0, latestMatches).map(entryItem => (
                  <View key={entryItem.matchId} style={styles.matchRow}>
                    <View style={styles.matchText}>
                      <Text style={styles.matchName}>{entryItem.opponentName || entryItem.title}</Text>
                      <Text style={styles.matchDate}>{formatDay(entryItem.matchDate)}</Text>
                    </View>
                    <Text style={styles.matchMinutes}>{entryMinutesText(entryItem)}</Text>
                  </View>
                ))}
                {olderMatches > 0 ? (
                  <Text style={styles.hint}>{olderMatches} earlier completed match(es) are counted in the total.</Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.hint}>No completed match has been recorded for this player yet.</Text>
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
            <Text style={styles.hint}>Each axis is the average of its metrics, from 1 at the centre to 5 on the outer ring.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ratings</Text>
            {METRICS_BY_CATEGORY.map(group => (
              <View key={group.key} style={styles.group}>
                <View style={styles.groupHead}>
                  <Text style={styles.groupTitle}>{group.label}</Text>
                  <Text style={styles.groupAverage}>{ratingText(averages[group.key])}</Text>
                </View>
                {group.metrics.map(metric => {
                  const value = profile.scores[metric.key] ?? null;
                  return (
                    <View key={metric.key} style={styles.metric}>
                      <View style={styles.metricHead}>
                        <Text style={styles.metricLabel}>{metric.label}</Text>
                        <Text style={styles.metricValue}>{ratingText(value)}</Text>
                      </View>
                      <View style={styles.metricTrack}>
                        <View style={[styles.metricFill, { width: fillWidth(value) }]} />
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Coach note</Text>
            <Text style={profile.coachNotes ? styles.notesText : styles.hint}>
              {profile.coachNotes || 'No coach note yet.'}
            </Text>
          </View>

          {notice ? <Text style={styles.error}>{notice}</Text> : null}
          <Text style={styles.footer}>
            Shared by {profile.player.teamName} with a Clubstride code
            {profile.generatedAt ? `, generated ${formatDay(profile.generatedAt.slice(0, 10))}` : ''}. This link is
            private to this player, so do not forward it.
          </Text>
        </>
      ) : null}
    </ScrollView>
  );
};

const styles = {
  screen: { padding: 16, gap: 12, backgroundColor: ci.color.background, flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 30 },
  close: { paddingVertical: 6, paddingHorizontal: 10 },
  closeLabel: { color: ci.color.primary, fontSize: 13, fontWeight: '800' },
  loading: { paddingVertical: 48, alignItems: 'center', gap: 10 },
  playerHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4 },
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
  notesText: { color: ci.color.text, fontSize: 13, lineHeight: 19 },
  footer: { color: ci.color.muted, fontSize: 11, lineHeight: 16, paddingBottom: 8 },
  codeInput: {
    padding: 10,
    borderRadius: ci.radius.control,
    backgroundColor: ci.color.background,
    borderWidth: 1,
    borderColor: ci.color.borderInput,
    color: ci.color.text,
    fontSize: 16,
    letterSpacing: 3,
    textAlign: 'center',
  },
  mono: { color: ci.color.muted, fontSize: 12, letterSpacing: 2, textAlign: 'center' },
  primary: { paddingVertical: 12, borderRadius: ci.radius.control, backgroundColor: ci.color.accent, alignItems: 'center' },
  primaryLabel: { color: ci.color.onAccent, fontSize: 14, fontWeight: '800' },
  secondary: { paddingVertical: 11, borderRadius: ci.radius.control, backgroundColor: ci.color.raised, alignItems: 'center' },
  secondaryLabel: { color: ci.color.text, fontSize: 13, fontWeight: '700' },
  error: { color: ci.color.danger, fontSize: 13, lineHeight: 19 },
} as const;
