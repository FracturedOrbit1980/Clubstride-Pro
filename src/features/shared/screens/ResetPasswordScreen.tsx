import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { AuthField, AuthScreen, LinkButton, PrimaryButton, authStyles } from '../components/AuthUi';
import { ci } from '../ci';

export const ResetPasswordScreen: React.FC = () => {
  const { recovery, clearRecovery, updatePassword, session } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (): Promise<void> => {
    if (busy) return;
    if (password.length < 8) {
      setError('Use at least 8 characters for your new password.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await updatePassword(password);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setDone(true);
  };

  if (recovery.checking) {
    return (
      <AuthScreen>
        <View style={authStyles.center}>
          <ActivityIndicator color={ci.color.primary} />
          <Text style={authStyles.muted}>Checking your reset link...</Text>
        </View>
      </AuthScreen>
    );
  }

  if (recovery.error) {
    return (
      <AuthScreen>
        <Text style={authStyles.cardTitle}>Reset link problem</Text>
        <Text style={authStyles.error}>{recovery.error}</Text>
        <PrimaryButton
          label={session ? 'Back to the app' : 'Back to sign in'}
          onPress={clearRecovery}
        />
        {!session ? (
          <Text style={authStyles.muted}>
            Request a new link from the sign-in screen, and open it on this phone.
          </Text>
        ) : null}
      </AuthScreen>
    );
  }

  if (done) {
    return (
      <AuthScreen>
        <Text style={authStyles.cardTitle}>Password updated</Text>
        <Text style={authStyles.success}>Your new password is saved and you are signed in.</Text>
        <Text style={authStyles.muted}>Use it the next time you sign in on another device.</Text>
        <PrimaryButton label="Continue" onPress={clearRecovery} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <Text style={authStyles.title}>Choose a new password</Text>
      <Text style={authStyles.subtitle}>
        {session?.user.email ? `Resetting the password for ${session.user.email}.` : 'Enter a new password for your account.'}
      </Text>

      <AuthField
        label="New password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        placeholder="At least 8 characters"
      />
      <AuthField
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        placeholder="Repeat your new password"
        onSubmitEditing={() => void submit()}
      />

      {error ? <Text style={authStyles.error}>{error}</Text> : null}

      <PrimaryButton label="Update password" onPress={() => void submit()} busy={busy} />

      <LinkButton
        label={session ? 'Cancel and go back to the app' : 'Cancel and go back to sign in'}
        onPress={clearRecovery}
      />
    </AuthScreen>
  );
};
