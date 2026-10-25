import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';
import {
  AuthField,
  AuthScreen,
  LinkButton,
  PrimaryButton,
  SecondaryButton,
  authStyles,
} from '../components/AuthUi';

interface SignInScreenProps {
  onCreateAccount: () => void;
  onForgotPassword: () => void;
}

export const SignInScreen: React.FC<SignInScreenProps> = ({ onCreateAccount, onForgotPassword }) => {
  const { signIn, signInWithGoogle, linkError, clearLinkError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'password' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (busy) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy('password');
    setError(null);
    clearLinkError();
    const failure = await signIn(cleanEmail, password);
    setError(failure);
    setBusy(null);
  };

  const google = async (): Promise<void> => {
    if (busy) return;
    setBusy('google');
    setError(null);
    clearLinkError();
    const failure = await signInWithGoogle();
    setError(failure);
    setBusy(null);
  };

  const shownError = error ?? linkError;

  return (
    <AuthScreen>
      <Text style={authStyles.title}>Sign in</Text>
      <Text style={authStyles.subtitle}>Sync your squads, fixtures and attendance.</Text>

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
        returnKeyType="next"
      />
      <AuthField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        placeholder="Your password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />

      <Pressable accessibilityRole="button" onPress={onForgotPassword} style={authStyles.forgot}>
        <Text style={authStyles.forgotLabel}>Forgot password?</Text>
      </Pressable>

      {shownError ? <Text style={authStyles.error}>{shownError}</Text> : null}

      <PrimaryButton
        label="Sign in"
        onPress={() => void submit()}
        busy={busy === 'password'}
        disabled={busy === 'google'}
      />

      <View style={authStyles.dividerRow}>
        <View style={authStyles.divider} />
        <Text style={authStyles.dividerText}>or</Text>
        <View style={authStyles.divider} />
      </View>

      <SecondaryButton
        label="Continue with Google"
        onPress={() => void google()}
        busy={busy === 'google'}
        disabled={busy === 'password'}
      />

      <View style={authStyles.linkRow}>
        <Text style={authStyles.muted}>New to Clubstride?</Text>
        <LinkButton label="Create an account" onPress={onCreateAccount} />
      </View>
    </AuthScreen>
  );
};
