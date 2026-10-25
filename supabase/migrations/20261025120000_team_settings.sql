-- ===============================================================================
-- Clubstride Pro - team settings and training days
-- 20261025120000
--
-- "Setup" needs somewhere to store which weekdays a squad trains, without giving
-- coaches write access to public.teams: teams_update_manager is manager-only, and
-- widening it would also let a coach rename the squad or hand it to another account.
--
-- One row per team, keyed by the team id itself. That is deliberate: the offline outbox
-- keys a queued write by (table, rowId) and upserts on `id`, so a settings row whose id
-- is the team's UUID can be queued, coalesced and replayed like any other sync row with
-- no client-side table mapping teams to settings ids.
-- ===============================================================================

CREATE TABLE IF NOT EXISTS public.team_settings (
  id            UUID PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  -- ISO weekdays, Monday = 1 .. Sunday = 7. Empty means no training is scheduled.
  training_days SMALLINT[] NOT NULL DEFAULT '{}'::SMALLINT[],
  -- Client timestamp, the last-write-wins version, mirroring matches and attendance.
  -- updated_at is never the version: a replay would overwrite it with the arrival time.
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT team_settings_training_days_are_weekdays CHECK (
    -- `<@` alone lets a NULL element through, because a NULL comparison is not false.
    array_position(training_days, NULL) IS NULL
    AND training_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[]
  )
);

COMMENT ON COLUMN public.team_settings.training_days IS
  'ISO weekdays (Mon=1..Sun=7) on which attendance sessions are taken.';

DROP TRIGGER IF EXISTS team_settings_touch ON public.team_settings;
CREATE TRIGGER team_settings_touch BEFORE UPDATE ON public.team_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Attendance predates this client and had no way to stamp its author: the outbox
-- refuses to send server-owned columns, so without a default every row would have
-- recorded_by = NULL. auth.uid() is the value the INSERT policy already trusts.
ALTER TABLE public.attendance ALTER COLUMN recorded_by SET DEFAULT auth.uid();

ALTER TABLE public.team_settings ENABLE ROW LEVEL SECURITY;

-- Members, parents included, may read the days: the training schedule is part of what a
-- squad shows. Only staff may change them, which is the whole reason this is not a
-- column on public.teams. The helpers live in schema `private` on the applied database;
-- `public.is_team_*` does not exist there and fails with 42883.
DROP POLICY IF EXISTS "settings_read_members" ON public.team_settings;
CREATE POLICY "settings_read_members" ON public.team_settings
  FOR SELECT USING (private.is_team_member(id));

DROP POLICY IF EXISTS "settings_staff_insert" ON public.team_settings;
CREATE POLICY "settings_staff_insert" ON public.team_settings
  FOR INSERT WITH CHECK (private.is_team_staff(id));

DROP POLICY IF EXISTS "settings_staff_update" ON public.team_settings;
CREATE POLICY "settings_staff_update" ON public.team_settings
  FOR UPDATE USING (private.is_team_staff(id)) WITH CHECK (private.is_team_staff(id));

-- No DELETE policy: the row disappears with its team (ON DELETE CASCADE), and no client
-- path removes it. Grants are correspondingly narrow.
GRANT SELECT, INSERT, UPDATE ON public.team_settings TO authenticated;

-- Supabase's default privileges grant ALL on every new public table to anon and
-- authenticated, so the GRANT above adds nothing by itself. RLS already hides rows from
-- anon, but the baseline's posture is that the anonymous key sees nothing at all.
REVOKE ALL ON public.team_settings FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.team_settings FROM authenticated;
