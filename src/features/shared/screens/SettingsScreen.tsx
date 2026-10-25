import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { useSyncQueue } from '../../../core/sync';
import { supabase } from '../../../core/supabaseClient';

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
  onOpenSquad: () => void;
  onOpenAttendance: () => void;
  onOpenSetup: () => void;
}> = ({ onOpenSquad, onOpenAttendance, onOpenSetup }) => {
  const { user, tier, memberships, signOut } = useAuth();
  const { pending, blocked, queue } = useSyncQueue();
  const [phase, setPhase] = useState<Phase>('idle');
  const [failure, setFailure] = useState<DeletionFailure | null>(null);

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
      <Text style={styles.title}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Account</Text>
        <Text style={styles.value}>{user?.email ?? 'No email on this session'}</Text>
        <Text style={styles.meta}>
          {tier === 'pro' ? 'Pro' : 'Lite'} - {memberships.length === 0 ? 'no squads' : `${memberships.length} squad(s)`}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Data on this phone</Text>
        <Text style={styles.meta}>
          {unsent === 0
            ? 'Everything recorded here has reached the club.'
            : `${unsent} change(s) are still only on this phone. Deleting the account discards them.`}
        </Text>
      </View>

      <Pressable style={styles.secondary} onPress={onOpenSquad} disabled={memberships.length === 0}>
        <Text style={[styles.secondaryLabel, memberships.length === 0 && styles.disabledLabel]}>View squad</Text>
      </Pressable>

      <Pressable style={styles.secondary} onPress={onOpenAttendance} disabled={memberships.length === 0}>
        <Text style={[styles.secondaryLabel, memberships.length === 0 && styles.disabledLabel]}>Attendance</Text>
      </Pressable>

      <Pressable style={styles.secondary} onPress={onOpenSetup} disabled={memberships.length === 0}>
        <Text style={[styles.secondaryLabel, memberships.length === 0 && styles.disabledLabel]}>Training setup</Text>
      </Pressable>

      <Pressable style={styles.secondary} onPress={() => void signOut()} disabled={phase === 'deleting'}>
        <Text style={styles.secondaryLabel}>Sign out</Text>
      </Pressable>

      <Pressable style={styles.destructive} onPress={() => setPhase('confirming')} disabled={phase === 'deleting'}>
        <Text style={styles.destructiveLabel}>Delete account</Text>
      </Pressable>

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
                <ActivityIndicator color="#f87171" />
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
  screen: { padding: 16, gap: 12, backgroundColor: '#0b0f17' },
  title: { color: '#e2e8f0', fontSize: 22, fontWeight: '800' },
  card: { padding: 12, borderRadius: 12, backgroundColor: '#1b1b22', gap: 4 },
  label: { color: '#94a3b8', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  value: { color: '#e2e8f0', fontSize: 15 },
  meta: { color: '#cbd5e1', fontSize: 13 },
  secondary: { padding: 12, borderRadius: 10, backgroundColor: '#1b1b22', alignItems: 'center' },
  secondaryLabel: { color: '#e2e8f0', fontSize: 15, fontWeight: '700' },
  disabledLabel: { color: '#475569' },
  destructive: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#7f1d1d', alignItems: 'center' },
  destructiveLabel: { color: '#f87171', fontSize: 15, fontWeight: '700' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  sheet: { borderRadius: 16, padding: 18, backgroundColor: '#15151d', gap: 10 },
  sheetTitle: { color: '#e2e8f0', fontSize: 17, fontWeight: '800' },
  sheetBody: { color: '#cbd5e1', fontSize: 14, lineHeight: 20 },
  sheetHint: { color: '#facc15', fontSize: 14, lineHeight: 20 },
  sheetWarning: { color: '#f87171', fontSize: 14, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  cancel: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#1b1b22' },
  cancelLabel: { color: '#cbd5e1', fontSize: 14, fontWeight: '700' },
  confirm: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#b91c1c' },
  confirmLabel: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  busyLabel: { color: '#cbd5e1', fontSize: 14 },
} as const;
