import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { AuthField, authStyles } from '../../shared/components/AuthUi';
import { ci } from '../../shared/ci';
import {
  DRILL_MINUTES_MAX,
  DRILL_MINUTES_MIN,
  DRILL_NAME_MAX,
  DRILL_NOTES_MAX,
  validateDrillDraft,
  type DrillDraft,
} from '../drills/drills';

export const DrillEditorScreen: React.FC<{
  draft: DrillDraft;
  teamName: string | null;
  onCancel: () => void;
  /** Returns the sentence to show the coach, or null once the drill is queued. */
  onSave: (draft: DrillDraft) => Promise<string | null>;
  onDelete: () => Promise<string | null>;
}> = ({ draft, teamName, onCancel, onSave, onDelete }) => {
  const existing = draft.id !== null;
  const [name, setName] = useState(draft.name);
  const [focus, setFocus] = useState(draft.focus);
  const [minutesText, setMinutesText] = useState(String(draft.minutes));
  const [notes, setNotes] = useState(draft.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const stepMinutes = (delta: number): void => {
    const current = Number(minutesText);
    const base = Number.isFinite(current) && minutesText.trim() !== '' ? current : draft.minutes;
    setMinutesText(String(Math.min(DRILL_MINUTES_MAX, Math.max(DRILL_MINUTES_MIN, Math.round(base + delta)))));
  };

  const save = async (): Promise<void> => {
    const candidate: DrillDraft = { id: draft.id, name, focus, minutes: Number(minutesText), notes };
    const problem = validateDrillDraft(candidate);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await onSave(candidate);
    setBusy(false);
    if (failure) setError(failure);
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const failure = await onDelete();
    setBusy(false);
    if (failure) {
      setConfirming(false);
      setError(failure);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.backLabel}>Drills</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>{existing ? 'Edit drill' : 'New drill'}</Text>
          <Text style={styles.headerMeta}>{teamName ?? 'No squad yet'}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <AuthField
          label="Drill name"
          value={name}
          onChangeText={setName}
          placeholder="Rondo 4v2"
          maxLength={DRILL_NAME_MAX}
          autoCapitalize="words"
          editable={!busy}
        />

        <AuthField
          label="Focus"
          value={focus}
          onChangeText={setFocus}
          placeholder="Passing, pressing, finishing..."
          maxLength={40}
          autoCapitalize="words"
          editable={!busy}
        />

        <View style={styles.field}>
          <Text style={styles.label}>Timer</Text>
          <View style={styles.minutesRow}>
            <Pressable
              style={styles.step}
              onPress={() => stepMinutes(-5)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Five minutes less"
            >
              <Text style={styles.stepLabel}>-5</Text>
            </Pressable>
            <View style={styles.minutesBox}>
              <TextInput
                value={minutesText}
                onChangeText={setMinutesText}
                keyboardType="number-pad"
                maxLength={3}
                editable={!busy}
                style={[authStyles.input, styles.minutesInput]}
                placeholderTextColor={ci.color.disabledText}
                selectionColor={ci.color.accent}
                accessibilityLabel="Drill length in minutes"
              />
              <Text style={styles.minutesUnit}>min</Text>
            </View>
            <Pressable
              style={styles.step}
              onPress={() => stepMinutes(5)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Five minutes more"
            >
              <Text style={styles.stepLabel}>+5</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>
            How long the timer runs when you start this drill. {DRILL_MINUTES_MIN}-{DRILL_MINUTES_MAX} minutes.
          </Text>
        </View>

        <AuthField
          label="How to run it"
          value={notes}
          onChangeText={setNotes}
          placeholder="Setup, rules, what the coach watches for"
          maxLength={DRILL_NOTES_MAX}
          multiline
          numberOfLines={4}
          editable={!busy}
          style={styles.notesInput}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.primary, busy && styles.primaryBusy]}
          onPress={() => void save()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy }}
        >
          {busy ? (
            <ActivityIndicator color={ci.color.onPrimary} />
          ) : (
            <Text style={styles.primaryLabel}>{existing ? 'Save drill' : 'Add drill'}</Text>
          )}
        </Pressable>

        <Text style={styles.hint}>Saves on this phone first, then syncs with the club.</Text>
      </View>

      {existing ? (
        confirming ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Delete this drill?</Text>
            <Text style={styles.hint}>
              It disappears from every phone after the next sync. Attendance and matches are not touched.
            </Text>
            <View style={styles.confirmRow}>
              <Pressable style={styles.secondary} onPress={() => setConfirming(false)} disabled={busy}>
                <Text style={styles.secondaryLabel}>Keep drill</Text>
              </Pressable>
              <Pressable style={styles.destructive} onPress={() => void remove()} disabled={busy}>
                <Text style={styles.destructiveLabel}>Delete drill</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={styles.deleteLink} onPress={() => setConfirming(true)} disabled={busy}>
            <Text style={styles.deleteLinkLabel}>Delete drill</Text>
          </Pressable>
        )
      ) : null}
    </ScrollView>
  );
};

const styles = {
  screen: { padding: 16, gap: 12, backgroundColor: ci.color.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised },
  backLabel: { color: ci.color.primary, fontSize: 13, fontWeight: '700' },
  headerText: { flex: 1, gap: 2 },
  title: { color: ci.color.text, fontSize: 22, fontWeight: '800' },
  headerMeta: { color: ci.color.muted, fontSize: 13 },
  card: { padding: 14, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 12 },
  cardTitle: { color: ci.color.text, fontSize: 16, fontWeight: '800' },
  field: { gap: 5 },
  label: { color: ci.color.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  minutesRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: { width: 54, paddingVertical: 12, borderRadius: ci.radius.control, backgroundColor: ci.color.raised, alignItems: 'center' },
  stepLabel: { color: ci.color.text, fontSize: 15, fontWeight: '800' },
  minutesBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  // minWidth 0 lets the input shrink inside the row; without it the browser keeps its
  // intrinsic width and pushes the "min" label off a phone-width screen.
  minutesInput: { flex: 1, minWidth: 0, textAlign: 'center', fontSize: 20, fontWeight: '800' },
  minutesUnit: { color: ci.color.muted, fontSize: 14, fontWeight: '700' },
  notesInput: { minHeight: 96, textAlignVertical: 'top' },
  hint: { color: ci.color.muted, fontSize: 13, lineHeight: 19 },
  error: { color: ci.color.danger, fontSize: 13, lineHeight: 19 },
  primary: { paddingVertical: 13, borderRadius: ci.radius.control, backgroundColor: ci.color.primary, alignItems: 'center', minHeight: 46, justifyContent: 'center' },
  primaryBusy: { backgroundColor: ci.color.disabledBg },
  primaryLabel: { color: ci.color.onPrimary, fontSize: 15, fontWeight: '800' },
  secondary: { flex: 1, paddingVertical: 11, borderRadius: ci.radius.control, backgroundColor: ci.color.raised, alignItems: 'center' },
  secondaryLabel: { color: ci.color.text, fontSize: 14, fontWeight: '700' },
  destructive: { flex: 1, paddingVertical: 11, borderRadius: ci.radius.control, borderWidth: 1, borderColor: ci.color.danger, alignItems: 'center' },
  destructiveLabel: { color: ci.color.danger, fontSize: 14, fontWeight: '800' },
  confirmRow: { flexDirection: 'row', gap: 10 },
  deleteLink: { alignSelf: 'flex-start', paddingVertical: 4 },
  deleteLinkLabel: { color: ci.color.danger, fontSize: 14, fontWeight: '700' },
} as const;
