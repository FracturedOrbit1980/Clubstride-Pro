import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { ci } from '../ci';

export type ProTab = 'squad' | 'register' | 'training' | 'settings';

const TABS: { key: ProTab; label: string }[] = [
  { key: 'squad', label: 'Squad' },
  { key: 'register', label: 'Register' },
  { key: 'training', label: 'Training' },
  { key: 'settings', label: 'Settings' },
];

/** The Lite dock, in the order a coach walks through a week: squad, register, training. */
export const TabBar: React.FC<{ active: ProTab; onChange: (tab: ProTab) => void }> = ({ active, onChange }) => (
  <View style={styles.bar}>
    {TABS.map(tab => {
      const selected = tab.key === active;
      return (
        <Pressable
          key={tab.key}
          onPress={() => onChange(tab.key)}
          style={[styles.tab, selected && styles.tabOn]}
          accessibilityRole="tab"
          accessibilityState={{ selected }}
          accessibilityLabel={tab.label}
        >
          <Text style={[styles.label, selected && styles.labelOn]}>{tab.label}</Text>
        </Pressable>
      );
    })}
  </View>
);

const styles = {
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: ci.color.background,
    borderTopWidth: 1,
    borderTopColor: ci.color.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: ci.radius.control,
    alignItems: 'center',
  },
  tabOn: { backgroundColor: ci.color.accent },
  label: { color: ci.color.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  labelOn: { color: ci.color.onAccent },
} as const;
