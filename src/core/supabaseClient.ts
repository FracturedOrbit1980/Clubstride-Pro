// Must precede supabase-js: auth-js builds the PKCE code_verifier from
// crypto.getRandomValues and silently falls back to Math.random() when crypto is absent.
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
export const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Fail at import, not at the first request. With a placeholder URL the client still
// constructs happily and every call comes back as an opaque fetch error mid-match.
if (!url || !anonKey || url.includes('YOUR_SUPABASE')) {
  throw new Error(
    'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env, then restart Metro with --clear.',
  );
}

// Untyped until the migration is applied and types are generated:
//   supabase gen types typescript --linked > src/types/database.types.ts
// then restore createClient<Database>. A hand-written stand-in would autocomplete wrong.
export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});
