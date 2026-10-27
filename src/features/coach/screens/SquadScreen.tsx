import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { supabase } from '../../../core/supabaseClient';
import { ci } from '../../shared/ci';

interface PlayerRow {
  id: string;
  full_name: string;
  shirt_number: number;
  position_tag: string | null;
  available: boolean;
}

type Phase = 'loading' | 'ready' | 'failed';

/**
 * Reads the squad through RLS: staff see every player on the team, a parent sees only their
 * own child. A failed read is shown with its message rather than an empty list, because an
 * empty squad and an unreachable backend look identical otherwise.
 */
export const SquadScreen: React.FC = () => {
  const { memberships } = useAuth();
  const membership = memberships.find(m => m.role !== 'parent') ?? memberships[0] ?? null;
  const teamId = membership?.teamId ?? null;

  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!teamId) {
      setPlayers([]);
      setPhase('ready');
      return;
    }
    setPhase('loading');
    setError(null);
    const { data, error: readError } = await supabase
      .from('players')
      .select('id, full_name, shirt_number, position_tag, available')
      .eq('team_id', teamId)
      .is('deleted_at', null)
      .order('shirt_number', { ascending: true });

    if (readError) {
      setError(readError.message);
      setPhase('failed');
      return;
    }
    setPlayers((data ?? []) as PlayerRow[]);
    setPhase('ready');
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const roleLabel = membership
    ? membership.role === 'manager'
      ? 'Manager'
      : membership.role === 'coach'
        ? 'Coach'
        : 'Parent'
    : null;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Squad</Text>

      {membership ? (
        <View style={styles.card}>
          <Text style={styles.label}>Team</Text>
          <Text style={styles.teamName}>{membership.teamName}</Text>
          <Text style={styles.meta}>
            {roleLabel} - {players.length} player(s)
          </Text>
        </View>
      ) : (
        <Text style={styles.meta}>This account is not on a squad yet.</Text>
      )}

      {phase === 'loading' ? <ActivityIndicator color={ci.color.primary} /> : null}

      {phase === 'failed' ? (
        <View style={styles.card}>
          <Text style={styles.meta}>Could not read the squad. Nothing here is cached from an earlier read.</Text>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => void load()}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'ready' && membership && players.length === 0 ? (
        <Text style={styles.meta}>No players in this squad yet.</Text>
      ) : null}

      {phase === 'ready'
        ? players.map(player => {
            const detail = [player.position_tag, player.available ? null : 'Unavailable']
              .filter(Boolean)
              .join(' - ');
            return (
              <View key={player.id} style={styles.playerRow}>
                <View style={styles.shirt}>
                  <Text style={styles.shirtLabel}>{player.shirt_number}</Text>
                </View>
                <View style={styles.playerText}>
                  <Text style={styles.playerName}>{player.full_name}</Text>
                  <Text style={styles.meta}>{detail || 'No position set'}</Text>
                </View>
              </View>
            );
          })
        : null}
    </ScrollView>
  );
};

const styles = {
  screen: { padding: 16, gap: 12, backgroundColor: ci.color.background },
  title: { color: ci.color.text, fontSize: 22, fontWeight: '800' },
  card: { padding: 14, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 4 },
  label: { color: ci.color.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  teamName: { color: ci.color.text, fontSize: 17, fontWeight: '800' },
  meta: { color: ci.color.muted, fontSize: 13 },
  error: { color: ci.color.danger, fontSize: 13 },
  retry: { marginTop: 4, paddingVertical: 8, paddingHorizontal: 14, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised, alignSelf: 'flex-start' },
  retryLabel: { color: ci.color.primary, fontSize: 14, fontWeight: '700' },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: ci.radius.card, backgroundColor: ci.color.surface },
  shirt: { width: 38, height: 38, borderRadius: 19, backgroundColor: ci.color.accent, alignItems: 'center', justifyContent: 'center' },
  shirtLabel: { color: ci.color.onAccent, fontSize: 15, fontWeight: '800' },
  playerText: { flex: 1, gap: 2 },
  playerName: { color: ci.color.text, fontSize: 15, fontWeight: '700' },
} as const;
