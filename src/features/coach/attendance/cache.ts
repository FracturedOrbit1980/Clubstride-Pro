import AsyncStorage from '@react-native-async-storage/async-storage';

export type CacheEntity = 'squad' | 'training' | 'attendance';

/**
 * Namespaced by account and team, like the outbox: two coaches share a phone at the club
 * sometimes, and one club's squad must not appear on the next account's screen.
 */
export const cacheKey = (entity: CacheEntity, userId: string, teamId: string): string =>
  `cs.${entity}.v1.${userId}.${teamId}`;

export interface CacheRead {
  raw: unknown;
  warning: string | null;
}

/** Never throws: an unreadable cache is reported so the screen can say it is showing live or
 * empty data rather than pretending the read succeeded. */
export async function readCache(key: string): Promise<CacheRead> {
  try {
    const stored = await AsyncStorage.getItem(key);
    if (stored === null) return { raw: null, warning: null };
    try {
      return { raw: JSON.parse(stored), warning: null };
    } catch {
      return { raw: null, warning: 'Saved data on this phone was unreadable and has been ignored.' };
    }
  } catch (error) {
    return { raw: null, warning: `Could not read saved data from this phone: ${String(error)}` };
  }
}

/** Returns a message for the coach, or null. The outbox already holds the change, so a failed
 * cache write costs the copy on disk, not the record. */
export async function writeCache(key: string, value: unknown): Promise<string | null> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return null;
  } catch (error) {
    return `Could not save this on the phone: ${String(error)}`;
  }
}
