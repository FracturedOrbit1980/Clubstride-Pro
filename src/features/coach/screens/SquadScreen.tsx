import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { mintRowId } from '../../../core/sync';
import type { SquadPlayerRow } from '../attendance/squad';
import { ci } from '../../shared/ci';
import { useClubRoster } from '../../shared/ClubRosterProvider';

export const SquadScreen: React.FC<{ onOpenPlayer: (player: SquadPlayerRow) => void }> = ({ onOpenPlayer }) => {
  const { membership, local, previewPlayers: players, warning, loading, teams, selectedTeam, selectTeam, reload, savePlayer, deletePlayer } = useClubRoster();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [position, setPosition] = useState('Midfielder');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const canEdit = membership?.role !== 'parent' && !!membership && (!!local || selectedTeam.startsWith('club:'));

  const edit = (player?: SquadPlayerRow): void => {
    setEditing(player?.id ?? 'new');
    setName(player?.full_name ?? '');
    setNumber(player ? String(player.shirt_number) : '');
    setPosition(player?.position_tag ?? 'Midfielder');
    setError(null);
    setDeleting(null);
  };
  const save = (): void => {
    try {
      const previous = players.find(player => player.id === editing);
      savePlayer({ id: previous?.id ?? mintRowId(), full_name: name, shirt_number: Number(number), position_tag: position, available: previous?.available ?? true });
      setEditing(null);
      setError(null);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>Squad</Text>
      {warning ? (
        <View style={styles.card}>
          <Text style={styles.error}>{warning}</Text>
          <Pressable style={styles.action} onPress={reload} accessibilityRole="button"><Text style={styles.actionLabel}>Try again</Text></Pressable>
        </View>
      ) : null}
      {membership ? (
        <View style={styles.card}>
          <Text style={styles.label}>Team</Text>
          <Text style={styles.teamName}>{membership.teamName}</Text>
          <Text style={styles.meta}>{membership.role === 'manager' ? 'Manager' : membership.role === 'coach' ? 'Coach' : 'Parent'} - {players.length} player(s)</Text>
          <Text style={styles.meta}>The same squad in Lite and Pro. Pro adds coaching tools.</Text>
          {teams.length > 1 ? teams.map(team => (
            <Pressable key={team.id} style={styles.action} onPress={() => selectTeam(team.id)} accessibilityRole="button"
              accessibilityState={{ selected: selectedTeam === team.id }}>
              <Text style={styles.actionLabel}>{selectedTeam === team.id ? 'Selected: ' : 'Use team: '}{team.name}</Text>
            </Pressable>
          )) : null}
        </View>
      ) : warning ? null : <Text style={styles.meta}>This account is not on a squad yet.</Text>}
      {loading ? <ActivityIndicator color={ci.color.primary} /> : null}
      {canEdit && editing === null ? <Pressable style={styles.action} onPress={() => edit()} accessibilityRole="button"><Text style={styles.actionLabel}>Add player</Text></Pressable> : null}
      {canEdit && editing !== null ? (
        <View style={styles.card}>
          <Text style={styles.teamName}>{editing === 'new' ? 'Add player' : 'Edit player'}</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Player name" placeholderTextColor={ci.color.muted} accessibilityLabel="Player name" />
          <TextInput style={styles.input} value={number} onChangeText={setNumber} keyboardType="number-pad" placeholder="Shirt number" placeholderTextColor={ci.color.muted} accessibilityLabel="Shirt number" />
          <View style={styles.row}>
            {['Goalkeeper', 'Defender', 'Midfielder', 'Forward'].map(value => (
              <Pressable key={value} style={styles.action} onPress={() => setPosition(value)} accessibilityRole="button" accessibilityState={{ selected: position === value }}>
                <Text style={styles.actionLabel}>{position === value ? '• ' : ''}{value}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <Pressable style={styles.action} onPress={save} accessibilityRole="button"><Text style={styles.actionLabel}>Save player</Text></Pressable>
            <Pressable style={styles.action} onPress={() => setEditing(null)} accessibilityRole="button"><Text style={styles.actionLabel}>Cancel</Text></Pressable>
          </View>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && membership && players.length === 0 && !warning ? <Text style={styles.meta}>No players in this squad yet.</Text> : null}
      {players.map(player => (
        <View key={player.id} style={styles.card}>
          <Pressable onPress={() => onOpenPlayer(player)} accessibilityRole="button" accessibilityLabel={`Open ${player.full_name}'s profile`} style={styles.playerRow}>
            <View style={styles.shirt}><Text style={styles.shirtLabel}>{player.shirt_number}</Text></View>
            <View style={styles.playerText}>
              <Text style={styles.playerName}>{player.full_name}</Text>
              <Text style={styles.meta}>{[player.position_tag, player.available ? null : 'Unavailable'].filter(Boolean).join(' - ') || 'No position set'}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          {canEdit ? (
            <View style={styles.row}>
              <Pressable style={styles.action} onPress={() => edit(player)} accessibilityRole="button" accessibilityLabel={`Edit ${player.full_name}`}><Text style={styles.actionLabel}>Edit</Text></Pressable>
              <Pressable style={styles.action} onPress={() => setDeleting(player.id)} accessibilityRole="button" accessibilityLabel={`Delete ${player.full_name}`}><Text style={styles.actionLabel}>Delete</Text></Pressable>
              {deleting === player.id ? <>
                <Pressable style={styles.action} accessibilityRole="button" onPress={() => {
                  try { deletePlayer(player.id); setDeleting(null); setError(null); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
                }}><Text style={styles.error}>Confirm delete</Text></Pressable>
                <Pressable style={styles.action} onPress={() => setDeleting(null)} accessibilityRole="button"><Text style={styles.actionLabel}>Keep player</Text></Pressable>
              </> : null}
            </View>
          ) : null}
        </View>
      ))}
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
  action: { marginTop: 4, paddingVertical: 8, paddingHorizontal: 12, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised, alignSelf: 'flex-start' },
  actionLabel: { color: ci.color.primary, fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { borderWidth: 1, borderColor: ci.color.border, borderRadius: ci.radius.chip, color: ci.color.text, padding: 10, marginTop: 8 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  chevron: { color: ci.color.muted, fontSize: 20, fontWeight: '700' },
  shirt: { width: 38, height: 38, borderRadius: 19, backgroundColor: ci.color.accent, alignItems: 'center', justifyContent: 'center' },
  shirtLabel: { color: ci.color.onAccent, fontSize: 15, fontWeight: '800' },
  playerText: { flex: 1, gap: 2 },
  playerName: { color: ci.color.text, fontSize: 15, fontWeight: '700' },
} as const;
