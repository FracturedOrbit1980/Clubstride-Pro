import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { useSyncQueue } from '../../../core/sync';
import { supabase } from '../../../core/supabaseClient';
import { BrandLockup } from '../components/BrandLockup';
import { ci } from '../ci';
import type { AppMode } from '../appMode';

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
  /** Only passed while signed out: leaves the sample squad for the sign-in screen. */
  onSignIn?: (() => void) | undefined;
}> = ({ mode, onModeChange, onOpenLite, onSignIn }) => {
  const { user, tier, memberships, signOut, preview } = useAuth();
  const { pending, blocked, queue } = useSyncQueue();
  const [phase, setPhase] = useState<Phase>('idle');
  const [failure, setFailure] = useState<DeletionFailure | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);

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
        <Text style={styles.value}>{preview ? 'Preview - not signed in' : user?.email ?? 'No email on this session'}</Text>
        <Text style={styles.meta}>
          {preview
            ? 'Pro - 1 sample squad'
            : `${tier === 'pro' ? 'Pro' : 'Lite'} - ${memberships.length === 0 ? 'no squads' : `${memberships.length} squad(s)`}`}
        </Text>
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
          {mode === 'pro'
            ? 'Squad, register, training and this account tab.'
            : 'Squad and training days only. The register and training setup come back in Pro.'}
        </Text>
        {modeError ? <Text style={styles.modeError}>{modeError}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Data on this phone</Text>
        <Text style={styles.meta}>
          {preview
            ? 'This is a sample squad bundled with the app. Nothing here is read from or sent to a club.'
            : unsent === 0
              ? 'Everything recorded here has reached the club.'
              : `${unsent} change(s) are still only on this phone. Deleting the account discards them.`}
        </Text>
      </View>

      {mode === 'lite' ? (
        <Pressable
          style={styles.secondary}
          onPress={onOpenLite}
          disabled={!preview && memberships.length === 0}
        >
          <Text
            style={[styles.secondaryLabel, !preview && memberships.length === 0 && styles.disabledLabel]}
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
