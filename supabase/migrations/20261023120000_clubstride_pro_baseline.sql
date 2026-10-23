-- ==============================================================================
-- Clubstride Pro - baseline schema (corrected from the 2026-10-23 draft)
--
-- Supabase / Postgres 15+. Run as a single migration:
--   supabase db push        (or: psql "$DB_URL" -v ON_ERROR_STOP=1 -f this file)
-- Idempotent: safe to re-run.
--
-- What changed against the draft, and why it mattered:
--   1. Role no longer comes from raw_user_meta_data. That field is client-supplied at
--      signup, so anyone could register as a manager; a value outside the enum also threw
--      inside the trigger, which Supabase swallows, leaving an auth.users row with no
--      profile. New accounts are always 'lite'; tier moves only via the service role.
--   2. Access is per-team membership, not a global role column and not teams.coach_id.
--      The draft's policies subqueried players from teams and teams from players, and
--      Postgres evaluates RLS inside policy expressions, so that pair recursed
--      infinitely. All policy logic now goes through SECURITY DEFINER helpers: the
--      function owner owns these tables, so it reads them without re-entering RLS.
--   3. Coaches can write. In Lite the coach runs the match; the draft only let
--      manager_id insert substitutions.
--   4. One match_events table covers goals, assists, substitutions and cards - 1:1 with
--      the events array the app already archives (endMatch in index.html), with the
--      sub out->in pairing and the period label kept.
--   5. Everything sync-relevant carries a client-supplied id, created_by, recorded_at and
--      a deleted_at tombstone, because Lite records matches on a phone with no signal and
--      replays them later. Undo deletes events, so deletes must survive the round trip.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSIONS & ENUMS
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE public.user_tier AS ENUM ('lite', 'pro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 'parent' existed in the draft's policies but not in its enum, and 'pro' is a billing
-- state rather than a permission. Tier lives on public.users, permission lives here.
DO $$ BEGIN
  CREATE TYPE public.team_member_role AS ENUM ('manager', 'coach', 'parent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.match_status AS ENUM ('scheduled', 'in_progress', 'paused', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Mirrors AppState.events[].type, plus the card kinds the CI icon set already ships.
DO $$ BEGIN
  CREATE TYPE public.match_event_kind AS ENUM ('goal', 'assist', 'substitution', 'card_yellow', 'card_red');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.attendance_type AS ENUM ('practice', 'match');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.attendance_status AS ENUM ('present', 'absent', 'late', 'excused');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------------------------
-- 2. TABLES
-- ------------------------------------------------------------------------------

-- 2.1 Profile row per auth.users. Public name kept as `users` to match the draft.
CREATE TABLE IF NOT EXISTS public.users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  tier        public.user_tier NOT NULL DEFAULT 'lite',
  first_name  TEXT,
  last_name   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.team_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  member_role  public.team_member_role NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, user_id, member_role)
);

-- One manager per team; coaches and parents are unlimited.
CREATE UNIQUE INDEX IF NOT EXISTS team_members_single_manager
  ON public.team_members (team_id) WHERE member_role = 'manager';

-- The app stores one `name` and one `number` per player, so the schema does too;
-- splitting into first/last would need the client to invent a second field.
CREATE TABLE IF NOT EXISTS public.players (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  shirt_number  INT NOT NULL CHECK (shirt_number BETWEEN 1 AND 99),
  position_tag  TEXT,
  available     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

-- Live rows only: a tombstoned player must not hold a shirt number hostage. Two players
-- swapping numbers in one transaction still trips this, so the sync client renumbers
-- through a free number rather than trading two rows in place.
CREATE UNIQUE INDEX IF NOT EXISTS players_one_number_per_team
  ON public.players (team_id, shirt_number) WHERE deleted_at IS NULL;

-- Guardianship is many-to-many and per player, which parent_id on players could not express.
CREATE TABLE IF NOT EXISTS public.player_guardians (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  relationship TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_id, user_id)
);

-- period_label and duration_seconds mirror AppState.clock: playing minutes are derived from
-- clock + substitutions per period, so a bare accumulated_seconds cannot reproduce them.
CREATE TABLE IF NOT EXISTS public.matches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT 'Match',
  opponent_name    TEXT NOT NULL CHECK (length(trim(opponent_name)) > 0),
  match_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  team_format      SMALLINT NOT NULL DEFAULT 7 CHECK (team_format IN (5, 7, 9, 11)),
  formation        TEXT,
  status           public.match_status NOT NULL DEFAULT 'scheduled',
  period_label     TEXT NOT NULL DEFAULT '1st Half' CHECK (period_label IN ('1st Half', '2nd Half')),
  duration_seconds INT NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  team_goals       INT NOT NULL DEFAULT 0 CHECK (team_goals >= 0),
  opponent_goals   INT NOT NULL DEFAULT 0 CHECK (opponent_goals >= 0),
  ended_at         TIMESTAMPTZ,
  created_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.match_players (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id         UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id        UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  listed_as        TEXT NOT NULL CHECK (listed_as IN ('starter', 'bench')),
  recorded_seconds INT CHECK (recorded_seconds >= 0),
  UNIQUE (match_id, player_id)
);

-- One row per client event. A goal writes a goal row plus an assist row that points back at
-- it (link_event_id), which is what deleteEvent relies on to undo both together.
CREATE TABLE IF NOT EXISTS public.match_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id          UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  kind              public.match_event_kind NOT NULL,
  actor_player_id   UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  second_player_id  UUID REFERENCES public.players(id) ON DELETE SET NULL,
  link_event_id     UUID REFERENCES public.match_events(id) ON DELETE CASCADE,
  period_label      TEXT NOT NULL DEFAULT '1st Half' CHECK (period_label IN ('1st Half', '2nd Half')),
  match_time_seconds INT NOT NULL DEFAULT 0 CHECK (match_time_seconds >= 0),
  created_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  CHECK (kind <> 'assist' OR link_event_id IS NOT NULL),
  CHECK (kind <> 'substitution' OR second_player_id IS NOT NULL),
  CHECK (id <> link_event_id)
);

-- The draft's progression_feedback.drill_id was an unbounded TEXT with no drills table.
CREATE TABLE IF NOT EXISTS public.drills (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  focus       TEXT,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.progression_feedback (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id          UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  coach_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  drill_id           UUID REFERENCES public.drills(id) ON DELETE SET NULL,
  performance_score  SMALLINT CHECK (performance_score BETWEEN 1 AND 10),
  coach_notes        TEXT,
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

-- UNIQUE NULLS NOT DISTINCT keeps a live row unique per player/session while still allowing a
-- corrected row after the original was tombstoned. Needs Postgres 15.
CREATE TABLE IF NOT EXISTS public.attendance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id     UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  session_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  session_type  public.attendance_type NOT NULL DEFAULT 'practice',
  status        public.attendance_status NOT NULL DEFAULT 'present',
  recorded_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,
  CONSTRAINT attendance_one_row_per_session
    UNIQUE NULLS NOT DISTINCT (player_id, session_date, session_type, deleted_at)
);

CREATE TABLE IF NOT EXISTS public.user_device_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  push_token  TEXT NOT NULL,
  platform    TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, push_token)
);

-- ------------------------------------------------------------------------------
-- 3. AUTHORISATION HELPERS  (SECURITY DEFINER - this is what stops the recursion)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  -- nullif first: an empty request.jwt.claims setting is not valid jsonb and would abort
  -- every profile update with a cast error.
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_team_member(p_team UUID, p_role public.team_member_role DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members m
    WHERE m.team_id = p_team
      AND m.user_id = auth.uid()
      AND (p_role IS NULL OR m.member_role = p_role)
  );
$$;

-- Any staff role on the team (a coach may record a match; a manager may too).
CREATE OR REPLACE FUNCTION public.is_team_staff(p_team UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_team_member(p_team, 'manager') OR public.is_team_member(p_team, 'coach');
$$;

CREATE OR REPLACE FUNCTION public.team_of_player(p_player UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT team_id FROM public.players WHERE id = p_player;
$$;

CREATE OR REPLACE FUNCTION public.team_of_match(p_match UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT team_id FROM public.matches WHERE id = p_match;
$$;

CREATE OR REPLACE FUNCTION public.is_guardian_of(p_player UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.player_guardians g
    WHERE g.player_id = p_player AND g.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_team(p_team UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_team IS NOT NULL AND (
    public.is_team_member(p_team)
    OR EXISTS (
      SELECT 1 FROM public.player_guardians g
      JOIN public.players pl ON pl.id = g.player_id
      WHERE pl.team_id = p_team AND g.user_id = auth.uid()
    )
  );
$$;

-- The fixture list is the one read a parent legitimately needs before a line-up exists: the
-- coach schedules a match weeks out, and "when do we play" cannot wait for team selection.
-- Scoped to the squad the child belongs to, so it still never reaches another family's child.
CREATE OR REPLACE FUNCTION public.child_on_team(p_team UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_team IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.players p
    WHERE p.team_id = p_team AND public.is_guardian_of(p.id)
  );
$$;

-- Was this match one of the current user's children's? Written as a SECURITY DEFINER
-- function rather than an in-policy subquery because both tables it reads have their own
-- read policies that this very decision governs; inlined, Postgres would nest one RLS check
-- inside another and a parent would filter match rows by the visibility of line-up rows that
-- are themselves filtered by the match's visibility.
--
-- Still needed beside child_on_team(): a child who has since moved squads would otherwise lose
-- the matches they actually played, because those matches belong to a team they are no longer
-- on.
CREATE OR REPLACE FUNCTION public.child_in_match(p_match UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_match IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.match_players mp
      WHERE mp.match_id = p_match AND public.is_guardian_of(mp.player_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.match_events me
      WHERE me.match_id = p_match
        AND (public.is_guardian_of(me.actor_player_id) OR public.is_guardian_of(me.second_player_id))
    )
  );
$$;

-- Listing teammates is a staff need: a coach has to know who is on the bench. public.users
-- carries email, name and tier, so a plain "shares a squad" test handed every parent the
-- contact details of every adult in the club. The role check is on the invoking user's own
-- membership, not the target's.
DROP FUNCTION IF EXISTS public.shares_team_with(UUID);
CREATE OR REPLACE FUNCTION public.shares_team_with_as_staff(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.team_members mine
    JOIN public.team_members theirs ON theirs.team_id = mine.team_id
    WHERE mine.user_id = auth.uid()
      AND theirs.user_id = p_user
      AND mine.member_role IN ('manager', 'coach')
  );
$$;

REVOKE ALL ON FUNCTION public.is_service_role(), public.is_team_member(UUID, public.team_member_role),
  public.is_team_staff(UUID), public.team_of_player(UUID), public.team_of_match(UUID),
  public.is_guardian_of(UUID), public.can_access_team(UUID), public.child_on_team(UUID),
  public.child_in_match(UUID), public.shares_team_with_as_staff(UUID)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_team_member(UUID, public.team_member_role),
  public.is_team_staff(UUID), public.team_of_player(UUID), public.team_of_match(UUID),
  public.is_guardian_of(UUID), public.can_access_team(UUID), public.child_on_team(UUID),
  public.child_in_match(UUID), public.shares_team_with_as_staff(UUID)
  TO authenticated;

-- guard_user_columns() runs as the invoking user, so a coach editing their own name needs
-- this or every profile update dies on a permission error. It returns only a boolean.
GRANT EXECUTE ON FUNCTION public.is_service_role() TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. TRIGGERS
-- ------------------------------------------------------------------------------

-- Signup profile row. Tier is never read from the request: metadata is client-controlled.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.users (id, email, tier, first_name, last_name)
  VALUES (
    NEW.id,
    -- OAuth and phone-only signups arrive with a null email; NOT NULL here would throw
    -- inside the trigger and leave the account without a profile row.
    coalesce(NEW.email, NEW.phone, ''),
    'lite',
    NULLIF(trim(NEW.raw_user_meta_data ->> 'first_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data ->> 'last_name'), '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Whoever creates a team becomes its manager, so there is no bootstrap window where an
-- authenticated user can create rows they cannot then see.
CREATE OR REPLACE FUNCTION public.attach_creator_as_manager()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.team_members (team_id, user_id, member_role)
    VALUES (NEW.id, NEW.created_by, 'manager')
    ON CONFLICT (team_id, user_id, member_role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teams_creator_becomes_manager ON public.teams;
CREATE TRIGGER teams_creator_becomes_manager
  AFTER INSERT ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.attach_creator_as_manager();

-- Tier and email are not self-service. Pro upgrades land via the payment provider, which
-- calls with the service role key.
CREATE OR REPLACE FUNCTION public.guard_user_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.tier IS DISTINCT FROM NEW.tier AND NOT public.is_service_role() THEN
    RAISE EXCEPTION 'tier changes require the service role';
  END IF;
  IF OLD.email IS DISTINCT FROM NEW.email AND NOT public.is_service_role() THEN
    RAISE EXCEPTION 'email is managed by the auth provider';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_guard_columns ON public.users;
CREATE TRIGGER users_guard_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_columns();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_touch ON public.users;
CREATE TRIGGER users_touch BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS teams_touch ON public.teams;
CREATE TRIGGER teams_touch BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS players_touch ON public.players;
CREATE TRIGGER players_touch BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS matches_touch ON public.matches;
CREATE TRIGGER matches_touch BEFORE UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS drills_touch ON public.drills;
CREATE TRIGGER drills_touch BEFORE UPDATE ON public.drills FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS feedback_touch ON public.progression_feedback;
CREATE TRIGGER feedback_touch BEFORE UPDATE ON public.progression_feedback FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS attendance_touch ON public.attendance;
CREATE TRIGGER attendance_touch BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS tokens_touch ON public.user_device_tokens;
CREATE TRIGGER tokens_touch BEFORE UPDATE ON public.user_device_tokens FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ------------------------------------------------------------------------------
ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_guardians     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_players        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drills               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progression_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_device_tokens   ENABLE ROW LEVEL SECURITY;

-- Read rule, stated once: staff (manager OR coach) see the whole squad; everyone else sees
-- only rows about their own linked children. can_access_team() is deliberately NOT used by
-- any child-data policy, because it is true for a parent membership and for a bare guardian
-- link - using it handed one family the other children's records. It survives for public.teams
-- (a squad name, needed to render the membership list) and public.drills (coach-authored
-- content, no child data in it).
--
-- public.matches is the one exception: a parent reads every fixture of the squad their child
-- is on, not only the ones the child was picked for. A fixture with no line-up yet is still
-- the answer to "when do we play", and a match row describes the squad's afternoon, not
-- another child's record.
--
-- Consequence for onboarding: a family needs BOTH rows. A member_role = 'parent' row without
-- a player_guardians row reads an empty app (the link is what makes a child's rows visible),
-- and a player_guardians row without a membership gives readable data with no squad to show
-- for it. Both are staff-written, so neither is optional.
--
-- FOR ALL without WITH CHECK silently reuses USING for inserts, which is not what a SELECT
-- shaped policy wants. Reads, writes and checks are stated separately below.
DROP POLICY IF EXISTS "users_read_own" ON public.users;
CREATE POLICY "users_read_own" ON public.users
  FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS "users_read_club_members" ON public.users;
DROP POLICY IF EXISTS "users_read_teammates" ON public.users;
CREATE POLICY "users_read_teammates" ON public.users
  FOR SELECT USING (public.shares_team_with_as_staff(id));

DROP POLICY IF EXISTS "users_update_own" ON public.users;
CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "teams_read_members" ON public.teams;
CREATE POLICY "teams_read_members" ON public.teams
  FOR SELECT USING (public.can_access_team(id));

DROP POLICY IF EXISTS "teams_create_own" ON public.teams;
CREATE POLICY "teams_create_own" ON public.teams
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "teams_update_manager" ON public.teams;
CREATE POLICY "teams_update_manager" ON public.teams
  FOR UPDATE USING (public.is_team_member(id, 'manager'))
  WITH CHECK (public.is_team_member(id, 'manager'));

DROP POLICY IF EXISTS "teams_delete_manager" ON public.teams;
CREATE POLICY "teams_delete_manager" ON public.teams
  FOR DELETE USING (public.is_team_member(id, 'manager'));

DROP POLICY IF EXISTS "members_read_team" ON public.team_members;
DROP POLICY IF EXISTS "members_read_self_or_staff" ON public.team_members;
CREATE POLICY "members_read_self_or_staff" ON public.team_members
  FOR SELECT USING (user_id = auth.uid() OR public.is_team_staff(team_id));

-- Only a manager assigns roles, and never to themselves.
DROP POLICY IF EXISTS "members_insert_manager" ON public.team_members;
CREATE POLICY "members_insert_manager" ON public.team_members
  FOR INSERT WITH CHECK (public.is_team_member(team_id, 'manager') AND user_id <> auth.uid());

DROP POLICY IF EXISTS "members_update_manager" ON public.team_members;
CREATE POLICY "members_update_manager" ON public.team_members
  FOR UPDATE USING (public.is_team_member(team_id, 'manager'))
  WITH CHECK (public.is_team_member(team_id, 'manager'));

DROP POLICY IF EXISTS "members_delete_self_or_manager" ON public.team_members;
CREATE POLICY "members_delete_self_or_manager" ON public.team_members
  FOR DELETE USING (user_id = auth.uid() OR public.is_team_member(team_id, 'manager'));

DROP POLICY IF EXISTS "players_read_team" ON public.players;
DROP POLICY IF EXISTS "players_read_own_or_staff" ON public.players;
CREATE POLICY "players_read_own_or_staff" ON public.players
  FOR SELECT USING (public.is_team_staff(team_id) OR public.is_guardian_of(id));

DROP POLICY IF EXISTS "players_staff_write" ON public.players;
CREATE POLICY "players_staff_write" ON public.players
  FOR INSERT WITH CHECK (public.is_team_staff(team_id) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "players_staff_update" ON public.players;
CREATE POLICY "players_staff_update" ON public.players
  FOR UPDATE USING (public.is_team_staff(team_id))
  WITH CHECK (public.is_team_staff(team_id));

DROP POLICY IF EXISTS "players_staff_delete" ON public.players;
CREATE POLICY "players_staff_delete" ON public.players
  FOR DELETE USING (public.is_team_staff(team_id));

DROP POLICY IF EXISTS "guardians_read" ON public.player_guardians;
CREATE POLICY "guardians_read" ON public.player_guardians
  FOR SELECT USING (user_id = auth.uid() OR public.is_team_staff(public.team_of_player(player_id)));

DROP POLICY IF EXISTS "guardians_staff_write" ON public.player_guardians;
CREATE POLICY "guardians_staff_write" ON public.player_guardians
  FOR ALL USING (public.is_team_staff(public.team_of_player(player_id)))
  WITH CHECK (public.is_team_staff(public.team_of_player(player_id)));

DROP POLICY IF EXISTS "matches_read_team" ON public.matches;
DROP POLICY IF EXISTS "matches_read_own_or_staff" ON public.matches;
CREATE POLICY "matches_read_own_or_staff" ON public.matches
  FOR SELECT USING (
    public.is_team_staff(team_id)
    OR public.child_on_team(team_id)
    OR public.child_in_match(id)
  );

-- The coach who ran the match owns the row they sync up; managers cover the whole team.
DROP POLICY IF EXISTS "matches_staff_write" ON public.matches;
CREATE POLICY "matches_staff_write" ON public.matches
  FOR INSERT WITH CHECK (public.is_team_staff(team_id) AND created_by = auth.uid());

DROP POLICY IF EXISTS "matches_staff_update" ON public.matches;
CREATE POLICY "matches_staff_update" ON public.matches
  FOR UPDATE USING (public.is_team_staff(team_id))
  WITH CHECK (public.is_team_staff(team_id));

DROP POLICY IF EXISTS "matches_staff_delete" ON public.matches;
CREATE POLICY "matches_staff_delete" ON public.matches
  FOR DELETE USING (public.is_team_member(team_id, 'manager'));

DROP POLICY IF EXISTS "match_players_read_team" ON public.match_players;
DROP POLICY IF EXISTS "match_players_read_own_or_staff" ON public.match_players;
CREATE POLICY "match_players_read_own_or_staff" ON public.match_players
  FOR SELECT USING (
    public.is_team_staff(public.team_of_match(match_id))
    OR public.is_guardian_of(player_id)
  );

DROP POLICY IF EXISTS "match_players_staff_write" ON public.match_players;
CREATE POLICY "match_players_staff_write" ON public.match_players
  FOR ALL USING (public.is_team_staff(public.team_of_match(match_id)))
  WITH CHECK (public.is_team_staff(public.team_of_match(match_id)));

DROP POLICY IF EXISTS "match_events_read_team" ON public.match_events;
DROP POLICY IF EXISTS "match_events_read_own_or_staff" ON public.match_events;
-- Both player columns are tested: a substitution or an assist names the child twice over, and
-- reading only the actor would hide half of the minutes the family came to see.
CREATE POLICY "match_events_read_own_or_staff" ON public.match_events
  FOR SELECT USING (
    public.is_team_staff(public.team_of_match(match_id))
    OR public.is_guardian_of(actor_player_id)
    OR public.is_guardian_of(second_player_id)
  );

DROP POLICY IF EXISTS "match_events_staff_write" ON public.match_events;
CREATE POLICY "match_events_staff_write" ON public.match_events
  FOR INSERT WITH CHECK (
    public.is_team_staff(public.team_of_match(match_id))
    AND created_by = auth.uid()
    AND public.team_of_player(actor_player_id) = public.team_of_match(match_id)
  );

DROP POLICY IF EXISTS "match_events_staff_update" ON public.match_events;
CREATE POLICY "match_events_staff_update" ON public.match_events
  FOR UPDATE USING (public.is_team_staff(public.team_of_match(match_id)))
  WITH CHECK (public.is_team_staff(public.team_of_match(match_id)));

DROP POLICY IF EXISTS "match_events_staff_delete" ON public.match_events;
CREATE POLICY "match_events_staff_delete" ON public.match_events
  FOR DELETE USING (public.is_team_staff(public.team_of_match(match_id)));

DROP POLICY IF EXISTS "drills_read_team" ON public.drills;
CREATE POLICY "drills_read_team" ON public.drills
  FOR SELECT USING (team_id IS NULL OR public.can_access_team(team_id));

DROP POLICY IF EXISTS "drills_staff_write" ON public.drills;
CREATE POLICY "drills_staff_write" ON public.drills
  FOR ALL USING (team_id IS NULL OR public.is_team_staff(team_id))
  WITH CHECK (team_id IS NULL OR public.is_team_staff(team_id));

DROP POLICY IF EXISTS "feedback_read" ON public.progression_feedback;
CREATE POLICY "feedback_read" ON public.progression_feedback
  FOR SELECT USING (coach_id = auth.uid() OR public.is_guardian_of(player_id)
    OR public.is_team_staff(public.team_of_player(player_id)));

DROP POLICY IF EXISTS "feedback_coach_write" ON public.progression_feedback;
CREATE POLICY "feedback_coach_write" ON public.progression_feedback
  FOR INSERT WITH CHECK (coach_id = auth.uid()
    AND public.is_team_staff(public.team_of_player(player_id)));

DROP POLICY IF EXISTS "feedback_coach_update" ON public.progression_feedback;
CREATE POLICY "feedback_coach_update" ON public.progression_feedback
  FOR UPDATE USING (coach_id = auth.uid()) WITH CHECK (coach_id = auth.uid());

DROP POLICY IF EXISTS "feedback_staff_delete" ON public.progression_feedback;
CREATE POLICY "feedback_staff_delete" ON public.progression_feedback
  FOR DELETE USING (public.is_team_staff(public.team_of_player(player_id)));

DROP POLICY IF EXISTS "attendance_read" ON public.attendance;
CREATE POLICY "attendance_read" ON public.attendance
  FOR SELECT USING (public.is_team_staff(team_id) OR public.is_guardian_of(player_id));

DROP POLICY IF EXISTS "attendance_staff_write" ON public.attendance;
CREATE POLICY "attendance_staff_write" ON public.attendance
  FOR INSERT WITH CHECK (public.is_team_staff(team_id)
    AND public.team_of_player(player_id) = team_id);

DROP POLICY IF EXISTS "attendance_staff_update" ON public.attendance;
CREATE POLICY "attendance_staff_update" ON public.attendance
  FOR UPDATE USING (public.is_team_staff(team_id)) WITH CHECK (public.is_team_staff(team_id));

DROP POLICY IF EXISTS "attendance_staff_delete" ON public.attendance;
CREATE POLICY "attendance_staff_delete" ON public.attendance
  FOR DELETE USING (public.is_team_member(team_id, 'manager'));

DROP POLICY IF EXISTS "tokens_own" ON public.user_device_tokens;
CREATE POLICY "tokens_own" ON public.user_device_tokens
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ------------------------------------------------------------------------------
-- 6. INDEXES  (Postgres does not index FK columns, and every policy above subqueries them)
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS team_members_team_idx  ON public.team_members (team_id);
CREATE INDEX IF NOT EXISTS team_members_user_idx  ON public.team_members (user_id);
CREATE INDEX IF NOT EXISTS players_team_idx       ON public.players (team_id);
CREATE INDEX IF NOT EXISTS guardians_player_idx   ON public.player_guardians (player_id);
CREATE INDEX IF NOT EXISTS guardians_user_idx     ON public.player_guardians (user_id);
CREATE INDEX IF NOT EXISTS matches_team_date_idx  ON public.matches (team_id, match_date DESC);
CREATE INDEX IF NOT EXISTS match_players_player_idx ON public.match_players (player_id);
CREATE INDEX IF NOT EXISTS match_events_match_idx ON public.match_events (match_id, match_time_seconds);
CREATE INDEX IF NOT EXISTS match_events_actor_idx ON public.match_events (actor_player_id);
-- Second because child_in_match() and the events read policy test both player columns, and an
-- unindexed OR over a foreign key turns every parent's match list into a sequential scan.
CREATE INDEX IF NOT EXISTS match_events_second_idx ON public.match_events (second_player_id);
CREATE INDEX IF NOT EXISTS match_events_link_idx  ON public.match_events (link_event_id);
CREATE INDEX IF NOT EXISTS drills_team_idx        ON public.drills (team_id);
CREATE INDEX IF NOT EXISTS feedback_player_idx    ON public.progression_feedback (player_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS feedback_coach_idx     ON public.progression_feedback (coach_id);
CREATE INDEX IF NOT EXISTS attendance_player_date_idx ON public.attendance (player_id, session_date DESC);
CREATE INDEX IF NOT EXISTS attendance_team_idx    ON public.attendance (team_id);

-- ------------------------------------------------------------------------------
-- 7. GRANTS
-- ------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO authenticated;

-- Named tables only. ON ALL TABLES IN SCHEMA public would widen any other table that
-- happens to live in this project.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.users, public.teams, public.team_members, public.players, public.player_guardians,
  public.matches, public.match_players, public.match_events, public.drills,
  public.progression_feedback, public.attendance, public.user_device_tokens
  TO authenticated;

-- Lite never talks to this database, so the anonymous role gets nothing on these tables.
-- Deliberately not REVOKE ... ON SCHEMA public or ON ALL TABLES: on a project that already
-- serves something else, those would either break it or abort the migration on a table this
-- role does not own.
REVOKE SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER ON
  public.users, public.teams, public.team_members, public.players, public.player_guardians,
  public.matches, public.match_players, public.match_events, public.drills,
  public.progression_feedback, public.attendance, public.user_device_tokens
  FROM anon;

-- ------------------------------------------------------------------------------
-- 8. REALTIME
--
-- match_events and matches carry children's data, so before pointing a club at this:
-- turn on Realtime Authorization (RLS) for the project and subscribe with an explicit
-- `.eq('team_id', ...)` channel filter. Broadcasting these rows to any authenticated
-- subscriber is a child-data leak, not a feature.
-- ------------------------------------------------------------------------------
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.match_events;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.matches      REPLICA IDENTITY DEFAULT;
ALTER TABLE public.match_events REPLICA IDENTITY DEFAULT;
