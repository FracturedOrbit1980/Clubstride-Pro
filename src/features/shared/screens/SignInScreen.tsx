import React, { useState } from 'react';
import { ActivityIndicator, Button, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../../core/context/AuthContext';

/**
 * Deliberately sign-in only. There is no in-app sign-up yet, so a new coach needs their account
 * created in the Supabase dashboard first - which is also how `handle_new_user()` gets exercised
 * before an OAuth provider is wired up.
 */
export const SignInScreen: React.FC = () => {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const failure = await signIn(email.trim().toLowerCase(), password);
    // Supabase returns the same vague message for a wrong password and an unknown account, so it
    // is shown verbatim rather than rephrased into something the app cannot know.
    setError(failure ? failure.message : null);
    setBusy(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Clubstride</Text>
      <Text style={styles.subtitle}>Sign in to sync your squads.</Text>

      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        placeholder="Email"
        placeholderTextColor="#64748b"
      />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        placeholder="Password"
        placeholderTextColor="#64748b"
        onSubmitEditing={() => void submit()}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {busy ? (
        <ActivityIndicator color="#facc15" />
      ) : (
        <Button title="Sign in" onPress={() => void submit()} />
      )}
    </View>
  );
};

const styles = {
  wrap: { flex: 1, justifyContent: 'center', gap: 10, padding: 24, backgroundColor: '#0b0f17' },
  title: { color: '#e2e8f0', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#94a3b8', fontSize: 14, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#e2e8f0',
    backgroundColor: '#15151d',
  },
  error: { color: '#f87171', fontSize: 13 },
} as const;
