import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import { AuthField, AuthScreen, LinkButton, PrimaryButton, authStyles } from '../components/AuthUi';

interface SignUpScreenProps {
  onBack: () => void;
}

const emailLooksValid = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const SignUpScreen: React.FC<SignUpScreenProps> = ({ onBack }) => {
  const { signUp } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    const outcome = await signUp({ email: cleanEmail, password, firstName, lastName });
    setBusy(false);
    if (outcome.error) {
      setError(outcome.error);
      return;
    }
    if (outcome.needsConfirmation) {
      setSentTo(cleanEmail);
    }
    // With auto-confirm switched on, signUp already created the session and the provider
    // swaps this screen for the app; there is nothing to confirm.
  };

  if (sentTo) {
    return (
      <AuthScreen>
        <Text style={authStyles.cardTitle}>Check your inbox</Text>
        <Text style={authStyles.muted}>
          If this address is new, we sent a confirmation link to {sentTo}. Open it, then come back
          and sign in.
        </Text>
        <Text style={authStyles.notice}>
          No email after a few minutes? The address may already have an account - sign in or reset
          the password instead. Otherwise the club has not finished setting up confirmation emails,
          and the owner needs to switch on email delivery in Supabase.
        </Text>
        <PrimaryButton label="Back to sign in" onPress={onBack} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <Text style={authStyles.title}>Create an account</Text>
      <Text style={authStyles.subtitle}>
        Register once, then sign in on any phone to keep the same squad and fixtures.
      </Text>

      <AuthField
        label="First name"
        value={firstName}
        onChangeText={setFirstName}
        autoCapitalize="words"
        autoComplete="name-given"
        textContentType="givenName"
        placeholder="Alex"
      />
      <AuthField
        label="Last name"
        value={lastName}
        onChangeText={setLastName}
        autoCapitalize="words"
        autoComplete="name-family"
        textContentType="familyName"
        placeholder="Morgan"
      />
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
      />
      <AuthField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        placeholder="At least 8 characters"
      />
      <AuthField
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        placeholder="Repeat your password"
        onSubmitEditing={() => void submit()}
      />

      {error ? <Text style={authStyles.error}>{error}</Text> : null}

      <PrimaryButton label="Create account" onPress={() => void submit()} busy={busy} />

      <View style={authStyles.linkRow}>
        <Text style={authStyles.muted}>Already registered?</Text>
        <LinkButton label="Sign in" onPress={onBack} />
      </View>
      <Text style={authStyles.muted}>
        A Google account can also be used, from the sign-in screen.
      </Text>
    </AuthScreen>
  );
};
