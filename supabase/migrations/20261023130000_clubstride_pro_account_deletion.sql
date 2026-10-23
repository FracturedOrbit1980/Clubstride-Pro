-- ===============================================================================
-- Clubstride Pro - account deletion (Google Play / data-safety compliance)
-- 20261023130000
--
-- Google Play requires that a user can delete their account *and* the personal data
-- that came with it, from inside the app, without contacting support. This migration
-- adds the RPC the RN client calls: public.delete_user_account().
--
-- Read section 1 before applying it. The baseline schema's cascade rules are correct for
-- a coach leaving a squad, but not for an account being erased: one of them deletes the
-- club's written history about children, and the other silently locks a squad out of its
-- own team settings forever.
-- ===============================================================================

-- ------------------------------------------------------------------------------
-- 1. ANONYMISE THE FEEDBACK AN EXITING COACH WROTE, DO NOT DELETE IT
--
-- progression_feedback.coach_id was NOT NULL ... ON DELETE CASCADE, so a single account
-- deletion destroyed every note that coach had written about a child. Those notes belong
-- to the child and the club, not to the author's login, and Play's requirement is about
-- the *deleting user's* data. This is the same call already made for the rows the coach
-- recorded: matches.created_by, match_events.created_by, drills.created_by and
-- attendance.recorded_by are all ON DELETE SET NULL, so the match archive survives the
-- coach who made it.
--
-- Dropping NOT NULL also means a replacement coach can keep editing the child's record.
-- ------------------------------------------------------------------------------
ALTER TABLE public.progression_feedback DROP CONSTRAINT IF EXISTS progression_feedback_coach_id_fkey;
ALTER TABLE public.progression_feedback ALTER COLUMN coach_id DROP NOT NULL;
ALTER TABLE public.progression_feedback
  ADD CONSTRAINT progression_feedback_coach_id_fkey
  FOREIGN KEY (coach_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- The cascade above performs an internal UPDATE, so feedback_touch rewrites updated_at for
-- anonymised rows. That is harmless for sync: last-write-wins compares the client's
-- recorded_at, never updated_at, which is why recorded_at is the version column here.

-- ------------------------------------------------------------------------------
-- 2. KEEP AUTHORLESS FEEDBACK EDITABLE
--
-- feedback_coach_update pinned both sides to coach_id = auth.uid(). Once the author is
-- gone that row could never be updated again, so an outgoing coach's notes would be
-- permanently frozen - and the sync client's tombstone path (an UPDATE) could not un-list
-- one. The replacement mirrors the read and delete policies on the same table.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "feedback_coach_update" ON public.progression_feedback;
CREATE POLICY "feedback_coach_update" ON public.progression_feedback
  FOR UPDATE
  USING (coach_id = auth.uid() OR public.is_team_staff(public.team_of_player(player_id)))
  WITH CHECK (coach_id = auth.uid() OR public.is_team_staff(public.team_of_player(player_id)));

-- ------------------------------------------------------------------------------
-- 3. THE DELETION ITSELF
-- ------------------------------------------------------------------------------

-- No users_delete_own policy is added on purpose. public.users is the *child* side of the
-- foreign key into auth.users, so a client-side DELETE there would leave an auth account
-- with no profile row - the 'noProfile' state the RN AuthContext already has to handle -
-- and would not delete the account. The only real deletion is of the auth.users row, and
-- that has to run with privileges no authenticated role has, hence SECURITY DEFINER.
--
-- SECURITY DEFINER also matters for section 1: the ON DELETE SET NULL cascade runs an
-- UPDATE on progression_feedback rows that belong to another team member's view of the
-- data. Under the invoking role those rows are not RLS-visible, and the cascade would
-- abort the deletion with a row-level security error. As the table owner it is not.
CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid  UUID := auth.uid();
  v_teams TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in before deleting your account.'
      USING ERRCODE = '42501';
  END IF;

  -- A squad is managed by exactly one member (team_members_single_manager), and every
  -- path that appoints the next one requires an existing manager: members_insert_manager,
  -- members_update_manager, teams_update_manager and teams_delete_manager all check
  -- is_team_member(team_id, 'manager'). team_members.user_id is ON DELETE CASCADE, so
  -- letting the sole manager vanish would delete the only row that could ever authorise a
  -- successor and strand the squad - with its players and match history - unmanageable.
  --
  -- Refusing is also the honest answer for the leaving coach: they hand over or close the
  -- squad first, which is what actually happens when a coach walks away from a club.
  -- SQLSTATE 45001 is unassigned, so the client can branch on it and show the hint.
  SELECT string_agg(t.name, ', ' ORDER BY t.name)
    INTO v_teams
  FROM public.team_members m
  JOIN public.teams t ON t.id = m.team_id
  WHERE m.user_id = v_uid
    AND m.member_role = 'manager';

  IF v_teams IS NOT NULL THEN
    RAISE EXCEPTION 'You are the only manager of: %', v_teams
      USING
        HINT = 'Appoint a replacement manager, or delete those teams, then delete your account again.',
        ERRCODE = '45001';
  END IF;

  -- One row, and the rest of the personal data follows it:
  --   auth.users            -> the login, and via Supabase's own cascades the sessions,
  --                             refresh tokens, identities and MFA factors
  --   public.users          -> email, name, tier              (ON DELETE CASCADE)
  --   team_members          -> the memberships                (ON DELETE CASCADE)
  --   player_guardians      -> the guardianship links         (ON DELETE CASCADE)
  --   user_device_tokens    -> push tokens                    (ON DELETE CASCADE)
  -- What is deliberately *not* deleted is anything about a child: players, matches,
  -- match_players, match_events, attendance and progression_feedback stay, with the
  -- deleting account's columns set to NULL. The players rows have no user foreign key at
  -- all, so a parent leaving cannot erase their child's record even by accident.
  DELETE FROM auth.users WHERE id = v_uid;
END;
$fn$;

REVOKE ALL ON FUNCTION public.delete_user_account() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_user_account() FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. WHAT THIS DOES NOT COVER
--
-- - Off-box copies. Play's data-deletion promise has to reach AsyncStorage on the phone
--   (the client clears cs.outbox.v1.<uid> after a successful call), the EAS build artefacts
--   if a screenshot was ever uploaded, and Supabase Storage once session photos exist.
--   Storage objects are keyed by user id and have to be listed and deleted separately.
-- - Backups / PITR. Supabase retains them; the policy text has to say so, because the
--   database cannot make a restore-point disappear on request.
-- - The web equivalent. Play requires a deletion path on the website too if the service
--   has one, and Lite's deployed page is that service's public face.
--
-- Applying as anything other than Supabase's postgres role fails on DELETE FROM auth.users
-- with insufficient_privilege. Supabase grants postgres all privileges on the auth schema's
-- tables in its own init scripts, so `supabase db push` and the dashboard SQL editor both
-- work; a migration runner using a custom role does not.
-- ------------------------------------------------------------------------------
