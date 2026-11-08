import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { ci } from '../ci';

const SYMBOL = require('../../../../assets/brand/l1-symbol.png');
const LITE_LOCKUP = require('../../../../assets/brand/l1-lite-lockup.png');
/** The approved Lite lockup art is 2088 x 384, so its width follows from the height asked for. */
const LITE_RATIO = 2088 / 384;

type Props = {
  size?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  /**
   * Which product the screen is showing. Lite carries its own approved lockup - the wordmark and
   * the LITE pill are drawn in that art, so it is never rebuilt from text and never reads
   * "Clubstride PRO" while the base app is on screen.
   */
  tier?: 'pro' | 'lite';
};

/** The L1 lockup: CI symbol, Clubstride wordmark and the tilted PRO pill, or the Lite art. */
export const BrandLockup: React.FC<Props> = ({ size = 30, onPress, accessibilityLabel, tier = 'pro' }) => {
  const content = tier === 'lite' ? (
    <Image
      source={LITE_LOCKUP}
      style={{ width: size * LITE_RATIO, height: size }}
      resizeMode="contain"
      accessibilityLabel="Clubstride Lite"
    />
  ) : (
    <>
      <Image source={SYMBOL} style={{ width: size, height: size }} resizeMode="contain" />
      {/* The lockup is app chrome beside a control, so it shares the dock's ceiling: uncapped, the
          largest Android font setting pushes whatever sits to its right off the screen. */}
      <Text style={[styles.wordmark, { fontSize: size * 0.74 }]} maxFontSizeMultiplier={1.3}>Clubstride</Text>
      <View
        style={[
          styles.pill,
          { paddingHorizontal: size * 0.26, paddingVertical: size * 0.05, marginLeft: size * 0.04 },
        ]}
      >
        <Text style={[styles.pillLabel, { fontSize: size * 0.33 }]} maxFontSizeMultiplier={1.3}>PRO</Text>
      </View>
    </>
  );

  if (!onPress) {
    return (
      <View
        accessibilityRole="image"
        accessibilityLabel={tier === 'lite' ? 'Clubstride Lite' : 'Clubstride Pro'}
        style={[styles.row, { gap: size * 0.3 }]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? 'Switch view'}
      hitSlop={10}
      style={[styles.row, styles.hit, { gap: size * 0.3 }]}
    >
      {content}
    </Pressable>
  );
};

const styles = {
  row: { flexDirection: 'row', alignItems: 'center' },
  // react-native-web ignores hitSlop, so the wordmark itself has to carry the 44-pixel target.
  hit: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  wordmark: { color: ci.color.text, fontWeight: '800', letterSpacing: -0.6 },
  pill: {
    backgroundColor: ci.color.accent,
    borderRadius: ci.radius.pill,
    transform: [{ rotate: '-6deg' }],
  },
  pillLabel: { color: ci.color.onAccent, fontWeight: '800', letterSpacing: 0.7 },
} as const;
