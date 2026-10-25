import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { Linking, Platform } from 'react-native';
import { createURL } from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { anonKey, supabase, url as supabaseUrl } from '../supabaseClient';

export type Tier = 'lite' | 'pro';
export type TeamRole = 'manager' | 'coach' | 'parent';

export interface SignUpInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface SignUpOutcome {
  error: string | null;
  needsConfirmation: boolean;
}

export interface RecoveryState {
  active: boolean;
  checking: boolean;
  error: string | null;
}

export interface Membership {
  teamId: string;
  teamName: string;
  role: TeamRole;
}

// 'noProfile' and 'profileUnavailable' are deliberately separate: the first means the
// signup trigger never wrote public.users, the second means we could not ask. A coach who
// is silently treated as having no access will just re-install the app and lose match data.
export type AuthStatus = 'loading' | 'ready' | 'signedOut' | 'noProfile' | 'profileUnavailable';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  tier: Tier;
  memberships: Membership[];
  status: AuthStatus;
  roleForTeam: (teamId: string) => TeamRole | null;
  isStaff: (teamId: string) => boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (input: SignUpInput) => Promise<SignUpOutcome>;
  requestPasswordReset: (email: string) => Promise<string | null>;
  updatePassword: (password: string) => Promise<string | null>;
  signInWithGoogle: () => Promise<string | null>;
  recovery: RecoveryState;
  clearRecovery: () => void;
  linkError: string | null;
  clearLinkError: () => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

interface RawMembershipRow {
  team_id: string;
  member_role: TeamRole;
  teams: { name: string } | { name: string }[] | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const teamNameOf = (row: RawMembershipRow): string => {
  const joined = Array.isArray(row.teams) ? row.teams[0] : row.teams;
  return joined?.name ?? 'Unnamed team';
};

interface WebLocation {
  origin: string;
  href: string;
  pathname: string;
}

const webLocation = (): WebLocation | null => {
  if (Platform.OS !== 'web') return null;
  const loc = (globalThis as { location?: Partial<WebLocation> }).location;
  if (!loc?.origin || !loc.href) return null;
  return { origin: loc.origin, href: loc.href, pathname: loc.pathname ?? '/' };
};

// Web keeps the browser origin and marks the link in the query string; native uses the
// clubstride:// scheme (or exp:// inside Expo Go). Supabase appends ?code= to either.
const redirectUrl = (kind: 'callback' | 'recovery'): string => {
  const web = webLocation();
  if (web) return kind === 'recovery' ? `${web.origin}/?auth=recovery` : `${web.origin}/?auth=callback`;
  return createURL(kind === 'recovery' ? 'reset-password' : 'auth-callback');
};

const clearWebAuthParams = (): void => {
  const web = webLocation();
  if (!web) return;
  const history = (globalThis as { history?: { replaceState: (data: unknown, unused: string, url?: string) => void } }).history;
  history?.replaceState(null, '', `${web.origin}${web.pathname}`);
};

// For non-special schemes like clubstride://auth-callback the first segment is the host,
// not the path; Expo Go's exp:// URL keeps it in the path. Check both or native links
// silently stop matching.
const isRecoveryUrl = (url: URL): boolean =>
  url.searchParams.get('auth') === 'recovery' ||
  url.hostname.toLowerCase().includes('reset-password') ||
  url.pathname.toLowerCase().includes('reset-password');

const isCallbackUrl = (url: URL): boolean => {
  const marker = url.searchParams.get('auth');
  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  return marker === 'callback' || marker === 'oauth' || hostname.includes('auth-callback') || pathname.includes('auth-callback');
};

const friendlyLinkError = (raw: string): string => {
  if (/access_denied/i.test(raw)) return 'Google sign-in was cancelled.';
  const text = raw.replace(/\+/g, ' ').trim();
  if (!text) return 'That link could not be used. Request a new one.';
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const GOOGLE_DISABLED_MESSAGE =
  'Google sign-in is not switched on for this club yet. Sign in with your email and password, or ask the club owner to enable Google sign-in.';

const friendlyGoogleError = (message: string): string =>
  /provider is not enabled|unsupported provider/i.test(message) ? GOOGLE_DISABLED_MESSAGE : message;

// Without this check the browser leaves the app for Supabase's raw JSON error page when the
// provider is off. null means the check itself failed, so the normal flow should decide.
const googleEnabled = async (): Promise<boolean | null> => {
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: anonKey } });
    if (!response.ok) return null;
    const settings = (await response.json()) as { external?: { google?: boolean } };
    return typeof settings.external?.google === 'boolean' ? settings.external.google : null;
  } catch {
    return null;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [tier, setTier] = useState<Tier>('lite');
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [recovery, setRecovery] = useState<RecoveryState>({ active: false, checking: false, error: null });
  const [linkError, setLinkError] = useState<string | null>(null);

  const settled = useRef(false);
  const profileLoadedFor = useRef<string | null>(null);
  const handledUrls = useRef<Set<string>>(new Set());
  const oauthInFlight = useRef(false);

  const loadProfile = useCallback(async (userId: string) => {
    profileLoadedFor.current = userId;
    const [profile, members] = await Promise.all([
      supabase.from('users').select('tier').eq('id', userId).maybeSingle(),
      supabase.from('team_members').select('team_id, member_role, teams ( name )').eq('user_id', userId),
    ]);

    if (profile.error || members.error) {
      setStatus('profileUnavailable');
      return;
    }
    if (!profile.data) {
      setStatus('noProfile');
      return;
    }

    const rows = (members.data ?? []) as unknown as RawMembershipRow[];
    setTier(profile.data.tier === 'pro' ? 'pro' : 'lite');
    setMemberships(
      rows.map(row => ({
        teamId: row.team_id,
        teamName: teamNameOf(row),
        role: row.member_role,
      })),
    );
    setStatus('ready');
  }, []);

  const applySession = useCallback(
    (next: Session | null) => {
      setSession(next);
      const nextUser = next?.user ?? null;
      setUser(nextUser);

      if (!nextUser) {
        profileLoadedFor.current = null;
        setTier('lite');
        setMemberships([]);
        setStatus('signedOut');
        return;
      }
      // TOKEN_REFRESHED lands here too, so only an unseen user id triggers a profile read.
      if (profileLoadedFor.current !== nextUser.id) void loadProfile(nextUser.id);
    },
    [loadProfile],
  );

  const handleRecoveryUrl = useCallback(async (rawUrl: string): Promise<void> => {
    setRecovery({ active: true, checking: true, error: null });
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      setRecovery({ active: true, checking: false, error: 'That reset link is not valid. Request a new one.' });
      return;
    }
    const linkError = parsed.searchParams.get('error_description') ?? parsed.searchParams.get('error');
    if (linkError) {
      setRecovery({ active: true, checking: false, error: friendlyLinkError(linkError) });
      return;
    }
    const code = parsed.searchParams.get('code');
    if (!code) {
      setRecovery({
        active: true,
        checking: false,
        error: 'This reset link is incomplete. Request a new one from the sign-in screen.',
      });
      return;
    }
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      setRecovery({
        active: true,
        checking: false,
        error: error ? `This reset link could not be used: ${error.message}` : null,
      });
    } catch (error) {
      setRecovery({
        active: true,
        checking: false,
        error: error instanceof Error ? error.message : 'This reset link could not be used. Request a new one.',
      });
    }
  }, []);

  const handleCallbackUrl = useCallback(async (rawUrl: string): Promise<string | null> => {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return 'The sign-in link is not valid. Try again.';
    }
    const linkError = parsed.searchParams.get('error_description') ?? parsed.searchParams.get('error');
    if (linkError) return friendlyLinkError(linkError);
    const code = parsed.searchParams.get('code');
    if (!code) return 'The sign-in link is incomplete. Try signing in again.';
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      return error?.message ?? null;
    } catch (error) {
      return error instanceof Error ? error.message : 'The sign-in link could not be used.';
    }
  }, []);

  useEffect(() => {
    let active = true;
    const listener = supabase.auth.onAuthStateChange((event, next) => {
      settled.current = true;
      if (event === 'PASSWORD_RECOVERY') {
        setRecovery({ active: true, checking: false, error: null });
      }
      if (active) applySession(next);
    });

    // The listener goes first: getSession() resolves later, and restoring its snapshot after
    // a SIGNED_OUT event would put a dead session back into state.
    void supabase.auth.getSession().then(({ data: { session: existing } }) => {
      if (!active || settled.current) return;
      settled.current = true;
      applySession(existing);
    });

    return () => {
      active = false;
      listener.data.subscription.unsubscribe();
    };
  }, [applySession]);

  // Reset links are opened from a mail client, not from a browser session the app controls,
  // so they arrive through Linking rather than openAuthSessionAsync. OAuth callbacks can
  // arrive through both; oauthInFlight keeps the listener from redeeming the same code twice.
  useEffect(() => {
    let active = true;
    const consume = async (rawUrl: string, source: 'initial' | 'event'): Promise<void> => {
      if (!rawUrl || handledUrls.current.has(rawUrl)) return;
      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        return;
      }
      const recoveryLink = isRecoveryUrl(parsed);
      const callbackLink = isCallbackUrl(parsed);
      if (!recoveryLink && !callbackLink) return;
      if (source === 'event' && callbackLink && !recoveryLink && oauthInFlight.current) return;
      handledUrls.current.add(rawUrl);
      if (recoveryLink) {
        await handleRecoveryUrl(rawUrl);
      } else {
        const failure = await handleCallbackUrl(rawUrl);
        if (failure && active) setLinkError(failure);
      }
      if (active) clearWebAuthParams();
    };

    const subscription = Linking.addEventListener('url', event => {
      void consume(event.url, 'event');
    });
    const web = webLocation();
    if (web) {
      // Expo web starts as a fresh document, so the URL is the only place the code can be.
      void consume(web.href, 'initial');
    } else {
      void Linking.getInitialURL()
        .then(url => {
          if (url) void consume(url, 'initial');
        })
        .catch(error => console.warn('Could not read the launch URL', error));
    }
    return () => {
      active = false;
      subscription.remove();
    };
  }, [handleCallbackUrl, handleRecoveryUrl]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      tier,
      memberships,
      status,
      roleForTeam: teamId => memberships.find(m => m.teamId === teamId)?.role ?? null,
      isStaff: teamId => {
        const role = memberships.find(m => m.teamId === teamId)?.role;
        return role === 'manager' || role === 'coach';
      },
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (!error) return null;
        if (/email not confirmed/i.test(error.message)) {
          return 'This email has not been confirmed yet. Open the confirmation link in your inbox, then sign in.';
        }
        return error.message;
      },
      signUp: async ({ email, password, firstName, lastName }) => {
        const metadata: Record<string, string> = {};
        const cleanFirst = firstName.trim();
        const cleanLast = lastName.trim();
        if (cleanFirst) metadata.first_name = cleanFirst;
        if (cleanLast) metadata.last_name = cleanLast;
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            ...(Object.keys(metadata).length > 0 ? { data: metadata } : {}),
            emailRedirectTo: redirectUrl('callback'),
          },
        });
        if (error) {
          return {
            error: /user already registered/i.test(error.message)
              ? 'An account already exists for that email. Sign in instead.'
              : error.message,
            needsConfirmation: false,
          };
        }
        return { error: null, needsConfirmation: !data.session };
      },
      requestPasswordReset: async email => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: redirectUrl('recovery'),
        });
        if (!error) return null;
        if (/redirect.*(not allowed|invalid)|invalid redirect/i.test(error.message)) {
          return "This build's reset link is not allowed by the club backend yet. Add the app URL under Supabase Authentication > URL Configuration > Redirect URLs.";
        }
        return error.message;
      },
      updatePassword: async password => {
        const { error } = await supabase.auth.updateUser({ password });
        return error?.message ?? null;
      },
      signInWithGoogle: async () => {
        if ((await googleEnabled()) === false) return GOOGLE_DISABLED_MESSAGE;
        const redirectTo = redirectUrl('callback');
        if (Platform.OS === 'web') {
          // A real browser wants a top-level redirect; a popup on a phone-sized layout only
          // strands the user when the browser blocks it.
          const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo },
          });
          return error ? friendlyGoogleError(error.message) : null;
        }
        oauthInFlight.current = true;
        try {
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo, skipBrowserRedirect: true },
          });
          if (error) return friendlyGoogleError(error.message);
          if (!data.url) return 'Google sign-in did not start. Try again.';
          const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
          if (result.type === 'cancel' || result.type === 'dismiss') return null;
          if (result.type !== 'success') return 'Google sign-in did not finish. Try again.';
          handledUrls.current.add(result.url);
          return await handleCallbackUrl(result.url);
        } finally {
          oauthInFlight.current = false;
        }
      },
      recovery,
      clearRecovery: () => setRecovery({ active: false, checking: false, error: null }),
      linkError,
      clearLinkError: () => setLinkError(null),
      // The SIGNED_OUT event runs applySession above; clearing state here as well would be a
      // second, racier version of the same reset.
      signOut: async () => {
        await supabase.auth.signOut();
      },
      refreshProfile: async () => {
        if (!user) return;
        profileLoadedFor.current = null;
        await loadProfile(user.id);
      },
    }),
    [session, user, tier, memberships, status, recovery, linkError, loadProfile, handleCallbackUrl],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
