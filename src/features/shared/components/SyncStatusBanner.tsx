import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSyncQueue } from '../../../core/sync';
import { ci } from '../ci';

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Offline-readiness has to be visible. A queue that silently stops draining looks identical to a
 * queue that has finished until the club asks why the match is missing, so anything the coach
 * would need to act on is shown here rather than logged.
 */
export const SyncStatusBanner: React.FC = () => {
  const { attached, flushing, pending, blocked, warning, lastFlushError, queue } = useSyncQueue();

  if (attached && !warning && !lastFlushError && blocked === 0 && pending === 0) return null;

  const headline = !attached
    ? 'Not signed in - changes are not queued for sync'
    : blocked > 0
      ? `${plural(blocked, 'change')} could not be sent`
      : warning
        ? 'Changes are held in memory only'
        : pending > 0
          ? `${plural(pending, 'change')} waiting for a signal`
          : 'Sync finished';

  const detail = warning ?? lastFlushError ?? (flushing ? 'Sending...' : 'Still only on this phone.');

  return (
    <View style={styles.wrap}>
      <Text style={styles.headline}>{headline}</Text>
      <Text style={styles.detail} numberOfLines={3}>
        {detail}
      </Text>
      {blocked > 0 ? (
        <Pressable style={styles.retry} onPress={() => queue.retryBlocked()}>
          <Text style={styles.retryLabel}>Retry now</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = {
  wrap: {
    padding: 12,
    borderRadius: ci.radius.card,
    backgroundColor: ci.color.surface,
    borderWidth: 1,
    borderColor: ci.color.border,
    marginHorizontal: 12,
  },
  headline: { color: ci.color.accent, fontSize: 14, fontWeight: '700' },
  detail: { color: ci.color.muted, fontSize: 12, marginTop: 4 },
  retry: { marginTop: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: ci.radius.chip, backgroundColor: ci.color.primary, alignSelf: 'flex-start' },
  retryLabel: { color: ci.color.onPrimary, fontSize: 12, fontWeight: '800' },
} as const;
