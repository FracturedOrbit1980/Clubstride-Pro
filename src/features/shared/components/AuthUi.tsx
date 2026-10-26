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
import { StatusBar } from 'expo-status-bar';
import { ci } from '../ci';
import { BrandLockup } from './BrandLockup';

export const AuthScreen: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <KeyboardAvoidingView style={authStyles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <StatusBar style="light" />
    <ScrollView
      contentContainerStyle={authStyles.screen}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      <BrandLockup size={32} />
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
      placeholderTextColor={ci.color.disabledText}
      selectionColor={ci.color.accent}
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
      {busy ? <ActivityIndicator color={ci.color.onPrimary} /> : <Text style={authStyles.primaryLabel}>{label}</Text>}
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
        <ActivityIndicator color={ci.color.muted} />
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
  flex: { flex: 1, backgroundColor: ci.color.background },
  screen: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 32,
    backgroundColor: ci.color.background,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  title: { color: ci.color.text, fontSize: 24, fontWeight: '800' },
  subtitle: { color: ci.color.muted, fontSize: 14, lineHeight: 20, marginBottom: 6 },
  field: { gap: 5 },
  label: { color: ci.color.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    borderWidth: 1,
    borderColor: ci.color.borderInput,
    borderRadius: ci.radius.control,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: ci.color.text,
    backgroundColor: ci.color.raised,
    fontSize: 15,
  },
  forgot: { alignSelf: 'flex-end', paddingVertical: 2 },
  forgotLabel: { color: ci.color.primary, fontSize: 13, fontWeight: '700' },
  error: { color: ci.color.danger, fontSize: 13, lineHeight: 19 },
  notice: { color: ci.color.warning, fontSize: 13, lineHeight: 19 },
  success: { color: ci.color.go, fontSize: 13, lineHeight: 19 },
  muted: { color: ci.color.muted, fontSize: 13, lineHeight: 19 },
  primary: {
    paddingVertical: 13,
    borderRadius: ci.radius.control,
    backgroundColor: ci.color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  primaryPressed: { opacity: 0.85 },
  primaryBlocked: { backgroundColor: ci.color.disabledBg },
  primaryLabel: { color: ci.color.onPrimary, fontSize: 15, fontWeight: '800' },
  secondary: {
    paddingVertical: 12,
    borderRadius: ci.radius.control,
    backgroundColor: ci.color.surface,
    borderWidth: 1,
    borderColor: ci.color.borderInput,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  secondaryPressed: { backgroundColor: ci.color.raised },
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
  secondaryLabel: { color: ci.color.text, fontSize: 15, fontWeight: '700' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 2 },
  divider: { flex: 1, height: 1, backgroundColor: ci.color.border },
  dividerText: { color: ci.color.muted, fontSize: 12, fontWeight: '700' },
  linkRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 4 },
  link: { color: ci.color.primary, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  card: { padding: 16, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 10 },
  cardTitle: { color: ci.color.text, fontSize: 18, fontWeight: '800' },
  back: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised },
  backLabel: { color: ci.color.primary, fontSize: 13, fontWeight: '700' },
  center: { alignItems: 'center', gap: 10, paddingVertical: 20 },
} as const;
