import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppMode = 'lite' | 'pro';

const MODE_KEY = 'cs.appMode.v1';

export const isAppMode = (value: unknown): value is AppMode => value === 'lite' || value === 'pro';

/** Pro is the default: the app ships as Pro, and Lite is a lens a coach opts into. */
export async function loadAppMode(): Promise<AppMode> {
  try {
    const stored = await AsyncStorage.getItem(MODE_KEY);
    return isAppMode(stored) ? stored : 'pro';
  } catch {
    // A preference that cannot be read is not club data; Pro is always a safe landing place.
    return 'pro';
  }
}

/** Returns a message for the coach, or null. The switch still applies; only its memory is lost. */
export async function saveAppMode(mode: AppMode): Promise<string | null> {
  try {
    await AsyncStorage.setItem(MODE_KEY, mode);
    return null;
  } catch (error) {
    return `Could not remember the view on this phone: ${String(error)}`;
  }
}
