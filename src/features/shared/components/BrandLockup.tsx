import React from 'react';
import { Image, Text, View } from 'react-native';
import { ci } from '../ci';

const SYMBOL = require('../../../../assets/brand/l1-symbol.png');

/** The L1 lockup: CI symbol, Clubstride wordmark and the tilted PRO pill. */
export const BrandLockup: React.FC<{ size?: number }> = ({ size = 30 }) => (
  <View
    accessibilityRole="image"
    accessibilityLabel="Clubstride Pro"
    style={[styles.row, { gap: size * 0.3 }]}
  >
    <Image source={SYMBOL} style={{ width: size, height: size }} resizeMode="contain" />
    <Text style={[styles.wordmark, { fontSize: size * 0.74 }]}>Clubstride</Text>
    <View
      style={[
        styles.pill,
        { paddingHorizontal: size * 0.26, paddingVertical: size * 0.05, marginLeft: size * 0.04 },
      ]}
    >
      <Text style={[styles.pillLabel, { fontSize: size * 0.33 }]}>PRO</Text>
    </View>
  </View>
);

const styles = {
  row: { flexDirection: 'row', alignItems: 'center' },
  wordmark: { color: ci.color.text, fontWeight: '800', letterSpacing: -0.6 },
  pill: {
    backgroundColor: ci.color.accent,
    borderRadius: ci.radius.pill,
    transform: [{ rotate: '-6deg' }],
  },
  pillLabel: { color: ci.color.onAccent, fontWeight: '800', letterSpacing: 0.7 },
} as const;
