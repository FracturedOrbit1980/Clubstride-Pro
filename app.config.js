// Expo passes the static app.json config as `config`. Return that same object so the
// values in app.json stay the source of truth (expo-doctor flags a dynamic config that
// throws the static config away).

/**
 * @param {string} key
 * @returns {string | null}
 */
function supabaseKeyRole(key) {
  if (typeof key !== 'string' || key.length === 0) return null;
  if (/sb_secret_/i.test(key)) return 'secret';
  const parts = key.split('.');
  if (parts.length < 2) {
    return /service_role/i.test(key) ? 'service_role' : null;
  }
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return /service_role/i.test(key) ? 'service_role' : null;
  }
}

function assertSupabaseClientEnv() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const role = supabaseKeyRole(key);
  if (role === 'service_role' || role === 'secret') {
    throw new Error(
      'Refusing to configure the app: EXPO_PUBLIC_SUPABASE_ANON_KEY is a Supabase secret (service_role). The client may only ship the anon key. Set it with `eas env:set` on the EAS environment. Never commit it.',
    );
  }

  // Set on the EAS builder. A local `expo start` / prebuild has no Supabase env and must still resolve.
  const productionBuild =
    process.env.EAS_BUILD === 'true' && process.env.EAS_BUILD_PROFILE === 'production';
  if (!productionBuild) return;

  const placeholder =
    url.length === 0 ||
    key.length === 0 ||
    url.includes('YOUR_SUPABASE') ||
    url.includes('YOUR-PROJECT') ||
    key === 'your-anon-key';
  if (placeholder) {
    throw new Error(
      'Production EAS build is missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Create both in the EAS production environment with `eas env:set` and visibility plaintext. Do not put the values in eas.json or git.',
    );
  }
}

module.exports = ({ config }) => {
  // GitHub Pages serves the web build from <repo>/ on the domain root. Only the export
  // sets this, so the local Metro server keeps serving from the origin root. The value is
  // a bare repo name because Git Bash rewrites values that start with a slash.
  const repo = process.env.EXPO_WEB_BASE_REPO;
  if (repo) {
    config.experiments = {
      ...(config.experiments ?? {}),
      baseUrl: `/${repo.replace(/^\/+|\/+$/g, '')}`,
    };
  }
  assertSupabaseClientEnv();
  return config;
};
