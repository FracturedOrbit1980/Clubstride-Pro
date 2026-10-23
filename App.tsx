import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/core/context/AuthContext';
import { SyncQueueProvider } from './src/core/sync';
import { SettingsScreen } from './src/features/shared/screens/SettingsScreen';
import { SignInScreen } from './src/features/shared/screens/SignInScreen';
import { SyncStatusBanner } from './src/features/shared/components/SyncStatusBanner';

/**
 * Every AuthStatus gets a screen. 'noProfile' means the signup trigger never wrote public.users,
 * and 'profileUnavailable' means the app could not ask - telling them apart is the whole reason
 * AuthContext defines both, so neither is folded into a spinner or a silent sign-out.
 */
const Problem: React.FC<{ title: string; body: string }> = ({ title, body }) => {
  const { refreshProfile, signOut } = useAuth();
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <View style={styles.row}>
        <Pressable style={styles.action} onPress={() => void refreshProfile()}>
          <Text style={styles.actionLabel}>Try again</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={() => void signOut()}>
          <Text style={styles.actionLabel}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
};

const Root: React.FC = () => {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>Restoring your session...</Text>
      </View>
    );
  }

  if (status === 'signedOut') return <SignInScreen />;

  if (status === 'noProfile') {
    return (
      <Problem
        title="No profile for this account"
        body="Your login exists, but the club database has no matching profile row, so nothing can be read or written for you. This is a backend problem, not a mistake you made - sign out and back in once, and if it stays, the account needs a profile row created."
      />
    );
  }

  if (status === 'profileUnavailable') {
    return (
      <Problem
        title="Cannot reach the club database"
        body="The app could not read your profile or squads. Anything you record now stays on this phone until the connection returns."
      />
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <SyncStatusBanner />
      <SettingsScreen />
    </View>
  );
};

const App: React.FC = () => (
  <AuthProvider>
    <SyncQueueProvider>
      <Root />
    </SyncQueueProvider>
  </AuthProvider>
);

export default App;

const styles = {
  screen: { flex: 1, backgroundColor: '#0b0f17', paddingTop: 8 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, padding: 24, backgroundColor: '#0b0f17' },
  title: { color: '#e2e8f0', fontSize: 18, fontWeight: '800' },
  body: { color: '#cbd5e1', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10, marginTop: 6 },
  action: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#1b1b22' },
  actionLabel: { color: '#facc15', fontSize: 14, fontWeight: '700' },
} as const;
