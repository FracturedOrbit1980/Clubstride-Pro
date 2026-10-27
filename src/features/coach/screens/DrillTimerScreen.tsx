import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ci } from '../../shared/ci';
import {
  drillSeconds,
  extendRemaining,
  formatClock,
  remainingFromDeadline,
  timerProgress,
  type Drill,
} from '../drills/drills';

/**
 * The coaching aid: a countdown for one drill, big enough to read at arm's length on a pitch.
 * The clock is derived from a deadline, so a backgrounded phone resumes at the right second
 * instead of drifting by however long the timers were throttled.
 */
export const DrillTimerScreen: React.FC<{ drill: Drill; onBack: () => void }> = ({ drill, onBack }) => {
  const total = drillSeconds(drill.minutes);
  const [remaining, setRemaining] = useState(total);
  const [running, setRunning] = useState(false);
  const deadline = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const next = remainingFromDeadline(deadline.current ?? Date.now(), Date.now());
      setRemaining(next);
      if (next === 0) setRunning(false);
    }, 250);
    return () => clearInterval(id);
  }, [running]);

  const start = (): void => {
    if (remaining === 0) return;
    deadline.current = Date.now() + remaining * 1000;
    setRunning(true);
  };

  const pause = (): void => {
    if (deadline.current !== null) setRemaining(remainingFromDeadline(deadline.current, Date.now()));
    setRunning(false);
  };

  const reset = (): void => {
    setRunning(false);
    deadline.current = null;
    setRemaining(total);
  };

  const addMinute = (): void => {
    const next = extendRemaining(remaining, 60);
    if (running) deadline.current = Date.now() + next * 1000;
    setRemaining(next);
  };

  const done = remaining === 0;
  const status = running ? 'Running' : done ? 'Time' : remaining === total ? 'Ready' : 'Paused';
  const progress = timerProgress(remaining, total);

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={onBack} accessibilityRole="button">
          <Text style={styles.backLabel}>Drills</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={2}>
            {drill.name}
          </Text>
          <Text style={styles.headerMeta}>
            {drill.focus ? `${drill.focus} - ` : ''}
            {drill.minutes} min drill
          </Text>
        </View>
      </View>

      <View style={[styles.clockCard, done && styles.clockCardDone]}>
        <Text style={[styles.status, running && styles.statusRunning, done && styles.statusDone]}>{status}</Text>
        <Text
          style={[styles.clock, running && styles.clockRunning, done && styles.clockDone]}
          accessibilityLabel={`${formatClock(remaining)} remaining`}
        >
          {formatClock(remaining)}
        </Text>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              running && styles.fillRunning,
              done && styles.fillDone,
              { width: `${Math.round(progress * 100)}%` },
            ]}
          />
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.primary, running && styles.primaryPaused, done && styles.primaryDone]}
          onPress={running ? pause : start}
          disabled={done}
          accessibilityRole="button"
          accessibilityLabel={running ? `Pause ${drill.name}` : `Start ${drill.name}`}
          accessibilityState={{ disabled: done }}
        >
          <Text style={[styles.primaryLabel, done && styles.primaryLabelDone]}>
            {running ? 'Pause' : done ? 'Time' : 'Start'}
          </Text>
        </Pressable>
        <View style={styles.secondaryRow}>
          <Pressable
            style={styles.secondary}
            onPress={reset}
            accessibilityRole="button"
            accessibilityLabel={`Reset ${drill.name} timer`}
          >
            <Text style={styles.secondaryLabel}>Reset</Text>
          </Pressable>
          <Pressable
            style={styles.secondary}
            onPress={addMinute}
            accessibilityRole="button"
            accessibilityLabel="Add one minute"
          >
            <Text style={styles.secondaryLabel}>+1 min</Text>
          </Pressable>
        </View>
      </View>

      {drill.notes ? (
        <View style={styles.card}>
          <Text style={styles.label}>How to run it</Text>
          <Text style={styles.notes}>{drill.notes}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
};

const styles = {
  screen: { padding: 16, gap: 14, backgroundColor: ci.color.background, flexGrow: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: ci.radius.chip, backgroundColor: ci.color.raised },
  backLabel: { color: ci.color.primary, fontSize: 13, fontWeight: '700' },
  headerText: { flex: 1, gap: 2 },
  title: { color: ci.color.text, fontSize: 22, fontWeight: '800' },
  headerMeta: { color: ci.color.muted, fontSize: 13 },
  clockCard: { padding: 18, borderRadius: ci.radius.sheet, backgroundColor: ci.color.surface, alignItems: 'center', gap: 10 },
  clockCardDone: { backgroundColor: ci.color.surface, borderWidth: 1, borderColor: ci.color.go },
  status: { color: ci.color.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  statusRunning: { color: ci.color.accent },
  statusDone: { color: ci.color.go },
  clock: { color: ci.color.text, fontSize: 76, fontWeight: '800', fontVariant: ['tabular-nums'] },
  clockRunning: { color: ci.color.accent },
  clockDone: { color: ci.color.go },
  track: { width: '100%', height: 8, borderRadius: ci.radius.pill, backgroundColor: ci.color.background, overflow: 'hidden' },
  fill: { height: 8, borderRadius: ci.radius.pill, backgroundColor: ci.color.muted },
  fillRunning: { backgroundColor: ci.color.accent },
  fillDone: { backgroundColor: ci.color.go },
  actions: { gap: 10 },
  primary: { paddingVertical: 18, borderRadius: ci.radius.control, backgroundColor: ci.color.go, alignItems: 'center' },
  primaryPaused: { backgroundColor: ci.color.warning },
  primaryDone: { backgroundColor: ci.color.disabledBg },
  primaryLabel: { color: ci.color.onGo, fontSize: 20, fontWeight: '800' },
  primaryLabelDone: { color: ci.color.disabledText },
  secondaryRow: { flexDirection: 'row', gap: 10 },
  secondary: { flex: 1, paddingVertical: 12, borderRadius: ci.radius.control, backgroundColor: ci.color.raised, alignItems: 'center' },
  secondaryLabel: { color: ci.color.text, fontSize: 15, fontWeight: '700' },
  card: { padding: 14, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 6 },
  label: { color: ci.color.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  notes: { color: ci.color.muted, fontSize: 14, lineHeight: 20 },
} as const;
