import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { ci } from '../ci';

export type ProTab = 'squad' | 'register' | 'training' | 'family' | 'settings';

export interface TabOption {
  key: ProTab;
  label: string;
}

/** The Lite dock, in the order a coach walks through a week: squad, register, training. */
export const COACH_TABS: readonly TabOption[] = [
  { key: 'squad', label: 'Squad' },
  { key: 'register', label: 'Register' },
  { key: 'training', label: 'Training' },
  { key: 'settings', label: 'Settings' },
];

/**
 * A parent gets no register and no squad list: taking attendance and editing players are coaching
 * controls, and the backend already refuses them. Two tabs is the whole job - the child's records,
 * then the account.
 */
export const PARENT_TABS: readonly TabOption[] = [
  { key: 'family', label: 'Family' },
  { key: 'settings', label: 'Settings' },
];

export const TabBar: React.FC<{
  active: ProTab;
  tabs?: readonly TabOption[];
  onChange: (tab: ProTab) => void;
}> = ({ active, tabs = COACH_TABS, onChange }) => (
  <View style={styles.bar}>
    {tabs.map(tab => {
      const selected = tab.key === active;
      return (
        <Pressable
          key={tab.key}
          onPress={() => onChange(tab.key)}
          style={[styles.tab, selected && styles.tabOn]}
          accessibilityRole="tab"
          // The aria alias, because react-native-web 0.21 does not read `accessibilityState`.
          aria-selected={selected}
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
    minHeight: 44,
    paddingVertical: 10,
    borderRadius: ci.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOn: { backgroundColor: ci.color.accent },
  label: { color: ci.color.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  labelOn: { color: ci.color.onAccent },
} as const;
