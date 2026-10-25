import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

export const AuthScreen: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <KeyboardAvoidingView style={authStyles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView
      contentContainerStyle={authStyles.screen}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      <Text style={authStyles.brand}>
        Club<Text style={authStyles.brandAccent}>stride</Text>
      </Text>
      {children}
    </ScrollView>
  </KeyboardAvoidingView>
);

interface AuthFieldProps extends TextInputProps {
  label: string;
}

export const AuthField: React.FC<AuthFieldProps> = ({ label, style, ...input }) => (
  <View style={authStyles.field}>
    <Text style={authStyles.label}>{label}</Text>
    <TextInput
      {...input}
      style={[authStyles.input, style]}
      placeholderTextColor="#64748b"
      selectionColor="#facc15"
    />
  </View>
);

interface ButtonProps {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}

export const PrimaryButton: React.FC<ButtonProps> = ({ label, onPress, busy = false, disabled = false }) => {
  const blocked = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        authStyles.primary,
        blocked && authStyles.primaryBlocked,
        pressed && !blocked && authStyles.primaryPressed,
      ]}
    >
      {busy ? <ActivityIndicator color="#111115" /> : <Text style={authStyles.primaryLabel}>{label}</Text>}
    </Pressable>
  );
};

export const SecondaryButton: React.FC<ButtonProps> = ({ label, onPress, busy = false, disabled = false }) => {
  const blocked = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        authStyles.secondary,
        blocked && authStyles.secondaryBlocked,
        pressed && !blocked && authStyles.secondaryPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color="#e2e8f0" />
      ) : (
        <View style={authStyles.secondaryInner}>
          <View style={authStyles.googleBadge}>
            <Text style={authStyles.googleBadgeLabel}>G</Text>
          </View>
          <Text style={authStyles.secondaryLabel}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
};

export const LinkButton: React.FC<{ label: string; onPress: () => void }> = ({ label, onPress }) => (
  <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8}>
    <Text style={authStyles.link}>{label}</Text>
  </Pressable>
);

export const authStyles = {
  flex: { flex: 1, backgroundColor: '#0b0f17' },
  screen: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 32,
    backgroundColor: '#0b0f17',
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  brand: { color: '#e2e8f0', fontSize: 26, fontWeight: '900', letterSpacing: -0.5, marginBottom: 4 },
  brandAccent: { color: '#facc15' },
  title: { color: '#e2e8f0', fontSize: 24, fontWeight: '800' },
  subtitle: { color: '#94a3b8', fontSize: 14, lineHeight: 20, marginBottom: 6 },
  field: { gap: 5 },
  label: { color: '#94a3b8', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#e2e8f0',
    backgroundColor: '#15151d',
    fontSize: 15,
  },
  forgot: { alignSelf: 'flex-end', paddingVertical: 2 },
  forgotLabel: { color: '#facc15', fontSize: 13, fontWeight: '700' },
  error: { color: '#f87171', fontSize: 13, lineHeight: 19 },
  notice: { color: '#facc15', fontSize: 13, lineHeight: 19 },
  success: { color: '#86efac', fontSize: 13, lineHeight: 19 },
  muted: { color: '#94a3b8', fontSize: 13, lineHeight: 19 },
  primary: {
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: '#facc15',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  primaryPressed: { opacity: 0.85 },
  primaryBlocked: { backgroundColor: '#263043' },
  primaryLabel: { color: '#111115', fontSize: 15, fontWeight: '800' },
  secondary: {
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#1b1b22',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  secondaryPressed: { backgroundColor: '#232330' },
  secondaryBlocked: { opacity: 0.6 },
  secondaryInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  googleBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleBadgeLabel: { color: '#1a73e8', fontSize: 13, fontWeight: '900' },
  secondaryLabel: { color: '#e2e8f0', fontSize: 15, fontWeight: '700' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2 },
  divider: { flex: 1, height: 1, backgroundColor: '#263043' },
  dividerText: { color: '#64748b', fontSize: 12, fontWeight: '700' },
  linkRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 4 },
  link: { color: '#facc15', fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  card: { padding: 16, borderRadius: 14, backgroundColor: '#1b1b22', gap: 10 },
  cardTitle: { color: '#e2e8f0', fontSize: 18, fontWeight: '800' },
  back: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#1b1b22' },
  backLabel: { color: '#facc15', fontSize: 13, fontWeight: '700' },
  center: { alignItems: 'center', gap: 10, paddingVertical: 20 },
} as const;
