import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { supabase } from '../../../core/supabaseClient';
import type { SquadPlayerRow } from '../../coach/attendance/squad';
import { formatDay } from '../../coach/attendance/week';
import type { PlayerAssessment } from '../../coach/player/assessment';
import { DEMO_ADULTS, DEMO_LINKS, previewAssessment } from '../../shared/demo';
import { useClubRoster } from '../../shared/ClubRosterProvider';
import { ci } from '../../shared/ci';
import { ratedText } from '../../parent/overview';
import {
  coachesOn, linksForPlayer, parseAssessmentRows, parseClubAdults, parseGuardianLinks, pendingText, playersWithoutLink,
  roleLabel, type ClubAdult, type GuardianLink,
} from '../clubRecords';

type Section = 'players' | 'families' | 'adults';
type Phase = 'loading' | 'ready';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'players', label: 'Players' },
  { key: 'families', label: 'Families' },
  { key: 'adults', label: 'Adults' },
];

/** Below this the two columns would each be too narrow to read, so the record stacks instead. */
const COLUMNS_AT = 900;

/**
 * The club administrator's own page: the squad, the family accounts the club has linked to it, and
 * the adults holding a seat. Which rows arrive is decided by the club's read policies, not here -
 * an account that manages two squads sees one at a time, because the squad is picked above this
 * screen. Nothing is written and nothing is cached: this is a page for a desk others may sit at.
 */
export const ClubAdminScreen: React.FC<{
  onOpenPlayer: (player: SquadPlayerRow) => void;
}> = ({ onOpenPlayer }) => {
  const { user } = useAuth();
  const { membership, previewPlayers, preview, warning, revision } = useClubRoster();
  const teamId = membership?.teamId ?? null;
  const teamName = membership?.teamName ?? 'Your Club';
  const players = previewPlayers;
  const playersKey = players.map(player => player.id).join(',');

  const [links, setLinks] = useState<GuardianLink[]>([]);
  const [adults, setAdults] = useState<ClubAdult[]>([]);
  const [ratings, setRatings] = useState<Record<string, PlayerAssessment>>({});
  const [section, setSection] = useState<Section>('players');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const { width } = useWindowDimensions();
  const columns = width >= COLUMNS_AT;
  const selected = players.find(player => player.id === selectedId) ?? null;

  useEffect(() => {
    let alive = true;
    setLoadError(null);

    if (preview) {
      const seeded: Record<string, PlayerAssessment> = {};
      for (const player of players) seeded[player.id] = previewAssessment(player.id);
      if (!alive) return undefined;
      setLinks(DEMO_LINKS);
      setAdults(DEMO_ADULTS);
      setRatings(seeded);
      setPhase('ready');
      return undefined;
    }

    if (!teamId || players.length === 0) {
      setLinks([]);
      setAdults([]);
      setRatings({});
      setPhase('ready');
      return undefined;
    }

    const playerIds = players.map(player => player.id);
    setPhase('loading');
    void (async () => {
      const [membersResult, guardiansResult, assessmentsResult] = await Promise.all([
        supabase
          .from('team_members')
          .select('user_id, member_role, users(first_name, last_name, email)')
          .eq('team_id', teamId),
        supabase
          .from('player_guardians')
          .select('id, player_id, user_id, relationship, created_at, users(first_name, last_name, email)')
          .in('player_id', playerIds),
        supabase
          .from('player_assessments')
          .select('id, player_id, scores, coach_notes, recorded_at')
          .eq('team_id', teamId)
          .is('deleted_at', null),
      ]);
      if (!alive) return;

      const failures: string[] = [];
      if (membersResult.error) failures.push(`Seats: ${membersResult.error.message}`);
      else {
        const parsed = parseClubAdults(membersResult.data);
        if (parsed.dropped > 0) failures.push(`${parsed.dropped} seat row(s) came back unreadable.`);
        setAdults(parsed.adults);
      }

      if (guardiansResult.error) failures.push(`Family links: ${guardiansResult.error.message}`);
      else {
        const parsed = parseGuardianLinks(guardiansResult.data);
        if (parsed.dropped > 0) failures.push(`${parsed.dropped} link row(s) came back unreadable.`);
        setLinks(parsed.links);
      }

      if (assessmentsResult.error) failures.push(`Ratings: ${assessmentsResult.error.message}`);
      else {
        const parsed = parseAssessmentRows(assessmentsResult.data);
        if (parsed.dropped > 0) failures.push(`${parsed.dropped} rating row(s) came back unreadable.`);
        setRatings(parsed.byPlayer);
      }

      setLoadError(failures.length > 0 ? `${failures.join(' ')} Nothing here has been saved on this device.` : null);
      setPhase('ready');
    })();

    return () => {
      alive = false;
    };
  }, [playersKey, preview, revision, reloadKey, teamId]);

  const unlinked = useMemo(() => playersWithoutLink(players, links), [players, links]);
  const coaches = useMemo(() => coachesOn(adults), [adults]);
  const selectedLinks = selected ? linksForPlayer(links, selected.id) : [];
  const scores = selected ? ratings[selected.id]?.scores ?? {} : {};

  if (!user && !preview) {
    return (
      <View style={styles.center}>
        <Text style={styles.meta}>Sign in with the account the club made a manager to see these records.</Text>
      </View>
    );
  }

  const profile = selected ? (
    <View style={styles.card}>
      <View style={styles.childRow}>
        <View style={styles.shirt}>
          <Text style={styles.shirtLabel}>{selected.shirt_number}</Text>
        </View>
        <View style={styles.childText}>
          <Text style={styles.childName}>{selected.full_name}</Text>
          <Text style={styles.meta}>{selected.position_tag ?? 'No position set'}</Text>
        </View>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Squad</Text>
        <Text style={styles.rowValue}>{teamName}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Availability</Text>
        <Text style={[styles.rowValue, { color: selected.available ? ci.color.go : ci.color.warning }]}>
          {selected.available ? 'Marked available' : 'Not marked available'}
        </Text>
      </View>
      <View style={styles.divider} />
      <Text style={styles.cardTitle}>Family accounts</Text>
      {selectedLinks.length === 0 ? (
        <Text style={styles.hint}>
          No family account reaches {selected.full_name}. Nothing on the development pages is visible to this child's
          family until the club records a link.
        </Text>
      ) : (
        selectedLinks.map(link => (
          <View key={link.id} style={styles.metaBlock}>
            <Text style={styles.strong}>{link.account?.name ?? 'An account outside this squad'}</Text>
            <Text style={styles.meta}>
              {link.account ? link.account.email : 'Their name and address stay in the club records, not in this app.'}
              {' · '}
              {link.relationship ?? 'No relationship noted'}
              {link.createdAt ? ` · linked ${formatDay(link.createdAt.slice(0, 10))}` : ' · linked'}
            </Text>
          </View>
        ))
      )}
      <Text style={styles.meta}>{ratedText(scores)}</Text>
      <Pressable
        onPress={() => onOpenPlayer(selected)}
        accessibilityRole="button"
        accessibilityLabel={`Open ${selected.full_name}'s full profile`}
        style={styles.outlineButton}
      >
        <Text style={styles.outlineLabel}>Open full profile</Text>
      </Pressable>
    </View>
  ) : (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>No child selected</Text>
      <Text style={styles.meta}>
        Select a child to see the squad record, the family accounts linked to them and how much of the rating sheet is
        filled in.
      </Text>
    </View>
  );

  const body = (
    <>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Club</Text>
          <Text style={styles.headerMeta}>{teamName} - manager</Text>
        </View>
        <Pressable
          onPress={() => setReloadKey(key => key + 1)}
          accessibilityRole="button"
          accessibilityLabel="Reload these club records"
          style={styles.reload}
        >
          <Text style={styles.reloadLabel}>Reload</Text>
        </Pressable>
      </View>

      {warning ? <Text style={styles.error}>{warning}</Text> : null}

      <View style={styles.sections}>
        {SECTIONS.map(option => {
          const on = option.key === section;
          return (
            <Pressable
              key={option.key}
              onPress={() => setSection(option.key)}
              accessibilityRole="tab"
              aria-selected={on}
              accessibilityLabel={option.label}
              style={[styles.sectionChip, on && styles.sectionChipOn]}
            >
              <Text style={[styles.sectionLabel, on && styles.sectionLabelOn]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {phase === 'loading' ? (
        <ActivityIndicator color={ci.color.primary} accessibilityLabel="Loading club records" />
      ) : players.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>This squad has no players yet</Text>
          <Text style={styles.meta}>
            Children are added on the Squad tab. Until then there is nothing to link a family account to.
          </Text>
        </View>
      ) : null}

      {phase === 'ready' && players.length > 0 && !columns && selected ? (
        <View style={styles.stackedProfile}>{profile}</View>
      ) : null}

      {phase === 'ready' && players.length > 0 && section === 'players' ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Players</Text>
          <Text style={styles.meta}>
            {players.length} on {teamName}. Selecting a child {columns ? 'fills the column beside this list' : 'shows the record above this list'}.
          </Text>
          {players.map(player => {
            const count = linksForPlayer(links, player.id).length;
            const on = player.id === selected?.id;
            return (
              <Pressable
                key={player.id}
                onPress={() => setSelectedId(player.id)}
                accessibilityRole="button"
                // Selection rides in the label rather than `aria-selected`: that attribute belongs to
                // tabs and options, and a row that opens a record is a button.
                accessibilityLabel={`${player.full_name}, number ${player.shirt_number}, ${count === 0 ? 'no family account' : `${count} family account${count === 1 ? '' : 's'}`}${on ? ', selected' : ''}`}
                style={[styles.listRow, on && styles.listRowOn]}
              >
                <Text style={styles.listShirt}>{player.shirt_number}</Text>
                <View style={styles.listText}>
                  <Text style={styles.listName}>{player.full_name}</Text>
                  <Text style={styles.meta}>{player.position_tag ?? 'No position set'}</Text>
                </View>
                <Text style={[styles.listAside, { color: count === 0 ? ci.color.warning : ci.color.muted }]}>
                  {count === 0 ? 'no family' : `${count} famil${count === 1 ? 'y' : 'ies'}`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {phase === 'ready' && players.length > 0 && section === 'families' ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Links on file</Text>
            <Text style={styles.meta}>
              Each link points at a child's stable id, never a name, so renaming a child cannot move a family onto
              another child by accident.
            </Text>
            {links.length === 0 ? (
              <Text style={styles.hint}>No family account is linked to this squad yet.</Text>
            ) : (
              links.map(link => {
                const child = players.find(player => player.id === link.playerId);
                return (
                  <Pressable
                    key={link.id}
                    onPress={() => child && setSelectedId(child.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${link.account?.name ?? 'An account outside this squad'} linked to ${child?.full_name ?? 'a child no longer on this squad'}`}
                    style={styles.listRow}
                  >
                    <View style={styles.listText}>
                      <Text style={styles.listName}>{link.account?.name ?? 'An account outside this squad'}</Text>
                      <Text style={styles.meta}>
                        {link.account ? `${link.account.email} · ` : 'Name and address stay out of this app · '}
                        {link.relationship ?? 'No relationship noted'}
                        {link.createdAt ? ` · linked ${formatDay(link.createdAt.slice(0, 10))}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.listAside}>{child?.full_name ?? 'Child not on this squad'}</Text>
                  </Pressable>
                );
              })
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Children no family can reach</Text>
            <Text style={styles.meta}>
              {unlinked.length === 0
                ? `Every child on ${teamName} has at least one family account linked.`
                : `${unlinked.length} of ${players.length} have no link, so nothing of theirs is readable at home.`}
            </Text>
            {unlinked.map(player => (
              <Pressable
                key={player.id}
                onPress={() => setSelectedId(player.id)}
                accessibilityRole="button"
                accessibilityLabel={`${player.full_name}, number ${player.shirt_number}, no family account`}
                style={styles.listRow}
              >
                <Text style={styles.listShirt}>{player.shirt_number}</Text>
                <View style={styles.listText}>
                  <Text style={styles.listName}>{player.full_name}</Text>
                </View>
                <Text style={[styles.listAside, { color: ci.color.warning }]}>no family</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {phase === 'ready' && players.length > 0 && section === 'adults' ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Seats on this squad</Text>
          <Text style={styles.meta}>
            A manager assigns these seats. The address beside each name is cut back to the first letter and the domain,
            because this page is often open on a shared desk.
          </Text>
          {adults.length === 0 ? (
            <Text style={styles.hint}>No seats could be read for this squad.</Text>
          ) : (
            adults.map(adult => (
              <View key={`${adult.role}-${adult.userId}`} style={styles.listRow}>
                <View style={styles.listText}>
                  <Text style={styles.listName}>{adult.account.name}</Text>
                  <Text style={styles.meta}>{adult.account.email}</Text>
                </View>
                <Text style={styles.listAside}>{roleLabel(adult.role)}</Text>
              </View>
            ))
          )}
        </View>
      ) : null}

      {phase === 'ready' && players.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>What this page cannot change yet</Text>
          <Text style={styles.meta}>
            The club's rules would let a manager record a family link, but an account in this app cannot look up a
            person who has not already joined a squad, so there is nothing to link a child to. That needs an invite or
            claim step the backend does not have yet. Moving a child between squads is the same story: it would rewrite
            which team their history belongs to. So this page reads and writes nothing.
          </Text>
          <Text style={styles.hint}>{pendingText(unlinked.length, coaches.length)}</Text>
        </View>
      ) : null}

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
    </>
  );

  return (
    <View style={styles.root}>
      <ScrollView style={styles.mainScroll} contentContainerStyle={styles.mainContent}>{body}</ScrollView>
      {columns ? (
        <ScrollView style={styles.columnScroll} contentContainerStyle={styles.columnContent}>
          {profile}
        </ScrollView>
      ) : null}
    </View>
  );
};

const styles = {
  // react-native-web's ScrollView carries flexGrow: 1 of its own, so a width alone gets grown
  // back to the leftover row and the column swallows the list. The grow has to be turned off too.
  root: { flex: 1, flexDirection: 'row', backgroundColor: ci.color.background },
  mainScroll: { flex: 1, minWidth: 0 },
  mainContent: { padding: 16, gap: 12 },
  columnScroll: { width: 340, flexGrow: 0, flexShrink: 0, borderLeftWidth: 1, borderLeftColor: ci.color.border },
  columnContent: { padding: 16, gap: 12 },
  stackedProfile: { marginBottom: 12 },
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
  sections: { flexDirection: 'row', gap: 8 },
  sectionChip: {
    flex: 1,
    minHeight: 44,
    borderRadius: ci.radius.control,
    borderWidth: 1,
    borderColor: ci.color.border,
    backgroundColor: ci.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionChipOn: { backgroundColor: ci.color.accent, borderColor: ci.color.accent },
  sectionLabel: { color: ci.color.muted, fontSize: 13, fontWeight: '700' },
  sectionLabelOn: { color: ci.color.onAccent },
  card: { padding: 14, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 10 },
  cardTitle: { color: ci.color.text, fontSize: 16, fontWeight: '800' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: ci.color.border,
  },
  listRowOn: { backgroundColor: ci.color.raised, borderRadius: ci.radius.control },
  listShirt: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: ci.color.background,
    borderWidth: 1,
    borderColor: ci.color.borderInput,
    color: ci.color.text,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 22,
  },
  listText: { flex: 1, gap: 2 },
  listName: { color: ci.color.text, fontSize: 15, fontWeight: '700' },
  listAside: { color: ci.color.muted, fontSize: 12, fontWeight: '700', maxWidth: 120, textAlign: 'right' },
  childRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shirt: { width: 46, height: 46, borderRadius: 23, backgroundColor: ci.color.accent, alignItems: 'center', justifyContent: 'center' },
  shirtLabel: { color: ci.color.onAccent, fontSize: 17, fontWeight: '800' },
  childText: { flex: 1, gap: 2 },
  childName: { color: ci.color.text, fontSize: 20, fontWeight: '800' },
  divider: { height: 1, backgroundColor: ci.color.border },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 32 },
  rowLabel: { color: ci.color.text, fontSize: 13, flex: 1 },
  rowValue: { color: ci.color.text, fontSize: 13, fontWeight: '800', maxWidth: 170, textAlign: 'right' },
  metaBlock: { gap: 2 },
  strong: { color: ci.color.text, fontSize: 14, fontWeight: '800' },
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
  meta: { color: ci.color.muted, fontSize: 13, lineHeight: 19 },
  hint: { color: ci.color.muted, fontSize: 12, lineHeight: 17 },
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
} as const;
