import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { AuthField, AuthScreen, LinkButton, PrimaryButton, authStyles } from '../components/AuthUi';

interface ForgotPasswordScreenProps {
  onBack: () => void;
}

const emailLooksValid = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const ForgotPasswordScreen: React.FC<ForgotPasswordScreenProps> = ({ onBack }) => {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (busy) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!emailLooksValid(cleanEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    const failure = await requestPasswordReset(cleanEmail);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setSentTo(cleanEmail);
  };

  if (sentTo) {
    return (
      <AuthScreen>
        <Text style={authStyles.cardTitle}>Check your inbox</Text>
        <Text style={authStyles.muted}>
          If an account exists for {sentTo}, a reset link is on its way. Open the link on this phone to
          choose a new password.
        </Text>
        <Text style={authStyles.notice}>
          The link expires after a short time. If it never arrives, ask the club owner to check that
          email delivery is set up in Supabase.
        </Text>
        <PrimaryButton label="Back to sign in" onPress={onBack} />
        <LinkButton label="Use a different email" onPress={() => setSentTo(null)} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <Text style={authStyles.title}>Reset your password</Text>
      <Text style={authStyles.subtitle}>
        Enter the email you sign in with. We will send a link that lets you choose a new password.
      </Text>

      <AuthField
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        autoCorrect={false}
        placeholder="you@club.com"
        returnKeyType="send"
        onSubmitEditing={() => void submit()}
      />

      {error ? <Text style={authStyles.error}>{error}</Text> : null}

      <PrimaryButton label="Send reset link" onPress={() => void submit()} busy={busy} />

      <View style={authStyles.linkRow}>
        <Text style={authStyles.muted}>Remembered it?</Text>
        <LinkButton label="Back to sign in" onPress={onBack} />
      </View>
    </AuthScreen>
  );
};
