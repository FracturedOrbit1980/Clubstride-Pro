import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/core/context/AuthContext';
import { SyncQueueProvider } from './src/core/sync';
import { AttendanceScreen } from './src/features/coach/screens/AttendanceScreen';
import { SetupScreen } from './src/features/coach/screens/SetupScreen';
import { SquadScreen } from './src/features/coach/screens/SquadScreen';
import { ForgotPasswordScreen } from './src/features/shared/screens/ForgotPasswordScreen';
import { ResetPasswordScreen } from './src/features/shared/screens/ResetPasswordScreen';
import { SettingsScreen } from './src/features/shared/screens/SettingsScreen';
import { SignInScreen } from './src/features/shared/screens/SignInScreen';
import { SignUpScreen } from './src/features/shared/screens/SignUpScreen';
import { SyncStatusBanner } from './src/features/shared/components/SyncStatusBanner';
import { ci } from './src/features/shared/ci';

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

type RootView = 'settings' | 'squad' | 'setup' | 'attendance';
type AuthView = 'signIn' | 'signUp' | 'forgot';

const Root: React.FC = () => {
  const { status, recovery } = useAuth();
  const [view, setView] = useState<RootView>('settings');
  const [authView, setAuthView] = useState<AuthView>('signIn');
  // Setup is reachable from both Settings and Attendance; Back has to return to the one the
  // coach came from, or editing the days dumps them on a screen they were not using.
  const [setupFrom, setSetupFrom] = useState<'settings' | 'attendance'>('settings');

  // A recovery link outranks every other screen: the exchange signs the user in, so waiting
  // for status would flash Settings before asking for the new password.
  if (recovery.active) return <ResetPasswordScreen />;

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>Restoring your session...</Text>
      </View>
    );
  }

  if (status === 'signedOut') {
    if (authView === 'signUp') return <SignUpScreen onBack={() => setAuthView('signIn')} />;
    if (authView === 'forgot') return <ForgotPasswordScreen onBack={() => setAuthView('signIn')} />;
    return (
      <SignInScreen
        onCreateAccount={() => setAuthView('signUp')}
        onForgotPassword={() => setAuthView('forgot')}
      />
    );
  }

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
      {view === 'squad' ? <SquadScreen onBack={() => setView('settings')} /> : null}
      {view === 'settings' ? (
        <SettingsScreen
          onOpenSquad={() => setView('squad')}
          onOpenAttendance={() => setView('attendance')}
          onOpenSetup={() => {
            setSetupFrom('settings');
            setView('setup');
          }}
        />
      ) : null}
      {view === 'attendance' ? (
        <AttendanceScreen
          onBack={() => setView('settings')}
          onOpenSetup={() => {
            setSetupFrom('attendance');
            setView('setup');
          }}
        />
      ) : null}
      {view === 'setup' ? (
        <SetupScreen onBack={() => setView(setupFrom)} onOpenAttendance={() => setView('attendance')} />
      ) : null}
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
  screen: { flex: 1, backgroundColor: ci.color.background, paddingTop: 8 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, padding: 24, backgroundColor: ci.color.background },
  title: { color: ci.color.text, fontSize: 18, fontWeight: '800' },
  body: { color: ci.color.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10, marginTop: 6 },
  action: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised },
  actionLabel: { color: ci.color.primary, fontSize: 14, fontWeight: '700' },
} as const;
