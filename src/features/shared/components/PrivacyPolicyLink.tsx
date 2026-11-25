import React from 'react';
import { Linking, Pressable, Text } from 'react-native';
import { ci } from '../ci';
import { DELETE_ACCOUNT_URL, PRIVACY_POLICY_URL } from '../legal';

function openExternal(url: string): void {
  void Linking.openURL(url).catch(() => {
    // A missing browser handler should not take down Settings or sign-up.
  });
}

export const ExternalLegalLink: React.FC<{ href: string; label: string }> = ({ href, label }) => (
  <Pressable
    accessibilityRole="link"
    accessibilityLabel={label}
    onPress={() => openExternal(href)}
    hitSlop={8}
    style={styles.tap}
  >
    <Text style={styles.label}>{label}</Text>
  </Pressable>
);

/** In-app privacy policy. Play requires the policy inside the app as well as on the store listing. */
export const PrivacyPolicyLink: React.FC = () => (
  <ExternalLegalLink href={PRIVACY_POLICY_URL} label="Privacy policy" />
);

/** Web deletion page named on the Play Data safety form. In-app deletion stays on this screen. */
export const WebDeletionLink: React.FC = () => (
  <ExternalLegalLink href={DELETE_ACCOUNT_URL} label="Delete an account on the web" />
);

const styles = {
  tap: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  label: { color: ci.color.primary, fontSize: 15, fontWeight: '700', textDecorationLine: 'underline' },
} as const;
