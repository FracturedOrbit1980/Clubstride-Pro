import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AuthError, Session, User } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient';

export type Tier = 'lite' | 'pro';
export type TeamRole = 'manager' | 'coach' | 'parent';

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
  signIn: (email: string, password: string) => Promise<AuthError | null>;
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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [tier, setTier] = useState<Tier>('lite');
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const settled = useRef(false);
  const profileLoadedFor = useRef<string | null>(null);

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

  useEffect(() => {
    let active = true;
    const listener = supabase.auth.onAuthStateChange((_event, next) => {
      settled.current = true;
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
        return error;
      },
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
    [session, user, tier, memberships, status, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
