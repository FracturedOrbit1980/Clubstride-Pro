import { registerRootComponent } from 'expo';
import App from './App';

// Entry point named by package.json "main". supabaseClient.ts throws while this import graph is
// being evaluated if EXPO_PUBLIC_SUPABASE_URL is missing, so a misconfigured build stops here
// with a readable error instead of bundling an app whose every request fails later.
registerRootComponent(App);
