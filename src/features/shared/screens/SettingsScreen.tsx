import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { useSyncQueue } from '../../../core/sync';
import { supabase } from '../../../core/supabaseClient';
import { BrandLockup } from '../components/BrandLockup';
import { TrainingDaysCard } from '../../coach/components/TrainingDaysCard';
import { isShareCode, normaliseShareCode } from '../../coach/player/shareCode';
import { ci } from '../ci';
import type { AppMode } from '../appMode';
import { useClubRoster } from '../ClubRosterProvider';

type Phase = 'idle' | 'confirming' | 'deleting' | 'failed';

interface DeletionFailure {
  message: string;
  hint: string | null;
  /** 45001 is raised by delete_user_account() when the caller still manages a squad. */
  needsHandover: boolean;
}

const toFailure = (error: { message: string; hint?: string | null; code?: string }): DeletionFailure => ({
  message: error.message,
  hint: error.hint ?? null,
  needsHandover: error.code === '45001',
});

/**
 * Shared across every tier and role: Google Play requires an in-app account deletion that does
 * not depend on contacting support, so it cannot live behind a Pro gate or a manager-only route.
 *
 * Two presses, then one RPC. The order after it succeeds is deliberate - the local outbox is
 * cleared while the session still names the account being deleted, then the session is dropped.
 */
export const SettingsScreen: React.FC<{
  mode: AppMode;
  onModeChange: (next: AppMode) => Promise<string | null>;
  onOpenLite: () => void;
  /** Only passed while signed out: opens account sign-in without changing the selected team. */
  onSignIn?: (() => void) | undefined;
  /** Opens a shared player report by the code printed on its PDF, with no account needed. */
  onOpenSharedProfile?: ((code: string) => void) | undefined;
}> = ({ mode, onModeChange, onOpenLite, onSignIn, onOpenSharedProfile }) => {
  const { user, tier, memberships, signOut, preview } = useAuth();
  const { membership, local, warning } = useClubRoster();
  const { pending, blocked, queue } = useSyncQueue();
  const [phase, setPhase] = useState<Phase>('idle');
  const [failure, setFailure] = useState<DeletionFailure | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [reportCode, setReportCode] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);

  const openReport = (): void => {
    const code = normaliseShareCode(reportCode);
    if (!isShareCode(code)) {
      setReportError('A code is eight characters, without I, O, 0 or 1.');
      return;
    }
    setReportError(null);
    setReportCode('');
    onOpenSharedProfile?.(code);
  };

  const applyMode = async (next: AppMode): Promise<void> => {
    if (next === mode) return;
    setModeError(await onModeChange(next));
  };

  const unsent = pending + blocked;

  const deleteAccount = async (): Promise<void> => {
    setPhase('deleting');
    const { error } = await supabase.rpc('delete_user_account');
    if (error) {
      // Shown, not logged: a coach who is still a manager has to be told which squad to hand
      // over, and a silent failure here would look like an app that cannot delete accounts.
      setFailure(toFailure(error));
      setPhase('failed');
      return;
    }
    setFailure(null);
    await queue.clearLocal();
    await signOut();
    // Signed out, so the root should have swapped this screen away. Reset anyway: a stuck
    // "Deleting..." spinner over a dead session is how a successful deletion looks broken.
    setPhase('idle');
  };

  const close = (): void => {
    setPhase('idle');
    setFailure(null);
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {mode === 'lite' ? (
        <BrandLockup size={28} onPress={() => void applyMode('pro')} accessibilityLabel="Switch to Pro view" />
      ) : null}
      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Account</Text>
        <Text style={styles.value}>{preview ? 'Not signed in' : user?.email ?? 'No email on this session'}</Text>
        <Text style={styles.meta}>
          {preview
            ? local ? 'Your selected team is saved on this device.' : warning ? 'Device team unavailable.' : '1 sample squad'
            : `${tier === 'pro' ? 'Pro' : 'Lite'} - ${memberships.length === 0 ? 'no club teams' : `${memberships.length} club team(s)`}`}
        </Text>
        {membership ? <Text style={styles.meta}>Selected team: {membership.teamName}{local ? ' - on this device' : preview ? ' - sample' : ' - club'}</Text> : null}
        {warning ? <Text style={styles.modeError}>{warning}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>View</Text>
        <View style={styles.modeRow}>
          {(['lite', 'pro'] as const).map(option => (
            <Pressable
              key={option}
              style={[styles.modeChip, mode === option && styles.modeChipOn]}
              onPress={() => void applyMode(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === option }}
            >
              <Text style={[styles.modeLabel, mode === option && styles.modeLabelOn]}>
                {option === 'lite' ? 'Lite' : 'Pro'}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.meta}>
          Lite and Pro are views of one app, using the same selected team and data in both directions.
          Pro adds the register, training setup and player feedback.
        </Text>
        {modeError ? <Text style={styles.modeError}>{modeError}</Text> : null}
      </View>

      <TrainingDaysCard />

      {onOpenSharedProfile ? (
        <View style={styles.card}>
          <Text style={styles.label}>Player reports</Text>
          <Text style={styles.meta}>
            {local ? 'Enter a shared club report code to open it. Reports saved for this device’s team do not have online share codes.' : "Enter a shared club report code to open that player's profile without signing in."}
          </Text>
          <TextInput
            value={reportCode}
            onChangeText={value => {
              setReportCode(value);
              setReportError(null);
            }}
            onSubmitEditing={openReport}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="ABCD2345"
            placeholderTextColor={ci.color.muted}
            maxLength={16}
            style={styles.codeInput}
            accessibilityLabel="Player report code"
          />
          {reportError ? <Text style={styles.modeError}>{reportError}</Text> : null}
          <Pressable
            style={styles.secondary}
            onPress={openReport}
            accessibilityRole="button"
            accessibilityLabel="Open the report for this code"
          >
            <Text style={styles.secondaryLabel}>Open report</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.label}>Data on this phone</Text>
        <Text style={styles.meta}>
          {local
            ? 'This team stays on this device until an authorized matching club team is selected. Switching Lite and Pro keeps the same team and data; signing in alone does not move it to a different club team.'
            : preview
              ? warning ? 'The device team could not be read. Samples are not shown.' : 'This is a sample squad bundled with the app. Nothing here is read from or sent to a club.'
              : unsent === 0
                ? 'No club changes are waiting in this phone’s sync queue. Lite and Pro use the same selected club team.'
                : `${unsent} club change(s) are still only on this phone. Deleting the account discards them.`}
        </Text>
      </View>

      {mode === 'lite' ? (
        <Pressable
          style={styles.secondary}
          onPress={onOpenLite}
          disabled={!membership}
        >
          <Text
            style={[styles.secondaryLabel, !membership && styles.disabledLabel]}
          >
            Open Lite view
          </Text>
        </Pressable>
      ) : null}

      {preview ? (
        onSignIn ? (
          <Pressable style={styles.secondary} onPress={onSignIn}>
            <Text style={styles.secondaryLabel}>Sign in</Text>
          </Pressable>
        ) : null
      ) : (
        <>
          <Pressable style={styles.secondary} onPress={() => void signOut()} disabled={phase === 'deleting'}>
            <Text style={styles.secondaryLabel}>Sign out</Text>
          </Pressable>

          <Pressable style={styles.destructive} onPress={() => setPhase('confirming')} disabled={phase === 'deleting'}>
            <Text style={styles.destructiveLabel}>Delete account</Text>
          </Pressable>
        </>
      )}

      <Modal visible={phase !== 'idle'} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.scrim}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {phase === 'failed' ? 'Account not deleted' : 'Delete this account permanently?'}
            </Text>
            {phase === 'failed' && failure ? (
              <>
                <Text style={styles.sheetBody}>{failure.message}</Text>
                {failure.needsHandover && failure.hint ? <Text style={styles.sheetHint}>{failure.hint}</Text> : null}
              </>
            ) : (
              <>
                <Text style={styles.sheetBody}>
                  Your login, name, email, squad memberships, guardian links and notification tokens are deleted
                  immediately and cannot be recovered.
                </Text>
                <Text style={styles.sheetBody}>
                  Match, line-up and progress records your squads depend on are kept, with your name removed from
                  them.
                </Text>
                {unsent > 0 ? <Text style={styles.sheetWarning}>{unsent} unsent change(s) will be lost.</Text> : null}
              </>
            )}

            {phase === 'deleting' ? (
              <View style={styles.busyRow}>
                <ActivityIndicator color={ci.color.danger} />
                <Text style={styles.busyLabel}>Deleting...</Text>
              </View>
            ) : (
              <View style={styles.actions}>
                <Pressable style={styles.cancel} onPress={close}>
                  <Text style={styles.cancelLabel}>{phase === 'failed' ? 'Close' : 'Cancel'}</Text>
                </Pressable>
                {phase === 'confirming' ? (
                  <Pressable style={styles.confirm} onPress={() => void deleteAccount()}>
                    <Text style={styles.confirmLabel}>Delete account</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = {
  screen: { padding: 16, gap: 12, backgroundColor: ci.color.background },
  title: { color: ci.color.text, fontSize: 22, fontWeight: '800' },
  card: { padding: 14, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 4 },
  label: { color: ci.color.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  value: { color: ci.color.text, fontSize: 15 },
  meta: { color: ci.color.muted, fontSize: 13 },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  modeChip: { flex: 1, paddingVertical: 10, borderRadius: ci.radius.control, backgroundColor: ci.color.raised, alignItems: 'center', borderWidth: 1, borderColor: ci.color.raised },
  modeChipOn: { backgroundColor: ci.color.accent, borderColor: ci.color.accent },
  modeLabel: { color: ci.color.text, fontSize: 14, fontWeight: '700' },
  modeLabelOn: { color: ci.color.onAccent },
  modeError: { color: ci.color.danger, fontSize: 13 },
  codeInput: {
    marginTop: 6,
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
  secondary: { padding: 12, borderRadius: ci.radius.control, backgroundColor: ci.color.raised, alignItems: 'center' },
  secondaryLabel: { color: ci.color.text, fontSize: 15, fontWeight: '700' },
  disabledLabel: { color: ci.color.disabledText },
  destructive: { padding: 12, borderRadius: ci.radius.control, borderWidth: 1, borderColor: ci.color.danger, alignItems: 'center' },
  destructiveLabel: { color: ci.color.danger, fontSize: 15, fontWeight: '700' },
  scrim: { flex: 1, backgroundColor: ci.color.scrim, justifyContent: 'center', padding: 20 },
  sheet: { borderRadius: ci.radius.sheet, padding: 18, backgroundColor: ci.color.surface, gap: 10 },
  sheetTitle: { color: ci.color.text, fontSize: 17, fontWeight: '800' },
  sheetBody: { color: ci.color.muted, fontSize: 14, lineHeight: 20 },
  sheetHint: { color: ci.color.warning, fontSize: 14, lineHeight: 20 },
  sheetWarning: { color: ci.color.danger, fontSize: 14, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  cancel: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised },
  cancelLabel: { color: ci.color.muted, fontSize: 14, fontWeight: '700' },
  confirm: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: ci.radius.chip, backgroundColor: ci.color.danger },
  confirmLabel: { color: ci.color.onDanger, fontSize: 14, fontWeight: '800' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  busyLabel: { color: ci.color.muted, fontSize: 14 },
} as const;
