-- ===============================================================================
-- Clubstride Pro - the coaching note only staff can read
-- 20261108120000
--
-- NOT YET APPLIED to the hosted project. The app reads this table and says plainly that the
-- field is missing until it is, so nothing here is simulated on the client.
--
-- player_assessments.coach_notes is the note a family reads: the guardian clause in
-- "assessments_read" lets a parent through, player_profile_by_code() hands it to whoever holds a
-- share code, and the report PDF carries it out of the app. A coach with something to write that
-- the family should not see has nowhere to put it, so the one field gets used for both jobs and
-- the honest version is the sentence left out.
--
-- This table is the private half. What matters is what is deliberately absent from it:
--   * no guardian clause anywhere - a parent's SELECT returns zero rows, not an error and not a
--     hint that a note exists;
--   * player_profile_by_code() is untouched, so a code holder cannot reach it;
--   * the PDF is assembled client-side from the assessment row, so it never sees this table.
--
-- One live row per player, rotated in place like the assessment. There is no history and no
-- DELETE: an old version of a staff note about a child would be a second record to protect and a
-- second chance for it to reach the wrong person.
--
-- As with the other Pro migrations, the helpers on the applied database live in schema `private`
-- and public.is_team_staff does not exist; using the wrong one fails with 42883.
-- ===============================================================================

-- ------------------------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------------------------

-- team_id is denormalised from players on purpose: every policy below tests it, and a policy
-- that resolved the team through players would re-enter that table's RLS on every row.
CREATE TABLE IF NOT EXISTS public.player_private_notes (
  player_id   UUID PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  -- Empty means "nothing written", not "cleared since": the app shows one honest line either way.
  note        TEXT NOT NULL DEFAULT '',
  updated_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_private_notes_length CHECK (length(note) <= 2000)
);

COMMENT ON COLUMN public.player_private_notes.note IS
  'Staff-only working note about one child. Never read by a guardian, a share code or the report PDF.';
COMMENT ON COLUMN public.player_private_notes.team_id IS
  'Copied from players on write. The policy tests it directly, so a coach on another squad gets nothing.';

-- ------------------------------------------------------------------------------
-- 2. Triggers
-- ------------------------------------------------------------------------------

-- auth.uid() is stamped by the database, so a client cannot claim authorship it does not have.
-- On a service-role write - a support fix, an import - it is simply NULL.
CREATE OR REPLACE FUNCTION public.player_private_notes_stamp_editor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS player_private_notes_touch ON public.player_private_notes;
CREATE TRIGGER player_private_notes_touch BEFORE UPDATE ON public.player_private_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS player_private_notes_editor ON public.player_private_notes;
CREATE TRIGGER player_private_notes_editor BEFORE INSERT OR UPDATE ON public.player_private_notes
  FOR EACH ROW EXECUTE FUNCTION public.player_private_notes_stamp_editor();

-- ------------------------------------------------------------------------------
-- 3. Row level security
-- ------------------------------------------------------------------------------

ALTER TABLE public.player_private_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "private_notes_read_staff" ON public.player_private_notes;
CREATE POLICY "private_notes_read_staff" ON public.player_private_notes
  FOR SELECT USING (private.is_team_staff(team_id));

-- The EXISTS keeps a staff member of team A from filing a note against team B's child by naming
-- a team they do belong to. Columns on the new row are named through the table: an unqualified
-- team_id inside the subquery would bind to players.team_id and make the check trivially true.
DROP POLICY IF EXISTS "private_notes_staff_insert" ON public.player_private_notes;
CREATE POLICY "private_notes_staff_insert" ON public.player_private_notes
  FOR INSERT WITH CHECK (
    private.is_team_staff(team_id)
    AND EXISTS (
      SELECT 1 FROM public.players p
      WHERE p.id = player_private_notes.player_id
        AND p.team_id = player_private_notes.team_id
    )
  );

-- An upsert needs both policies. There is no UPDATE-only clause that differs from INSERT: the
-- note travels with the child, and the writer's seat on that squad is the whole test.
DROP POLICY IF EXISTS "private_notes_staff_update" ON public.player_private_notes;
CREATE POLICY "private_notes_staff_update" ON public.player_private_notes
  FOR UPDATE USING (private.is_team_staff(team_id))
  WITH CHECK (
    private.is_team_staff(team_id)
    AND EXISTS (
      SELECT 1 FROM public.players p
      WHERE p.id = player_private_notes.player_id
        AND p.team_id = player_private_notes.team_id
    )
  );

-- Deliberately nothing else. A table with one SELECT policy and no others still answers a
-- guardian's query with an empty set, which is the outcome: the parent's app cannot tell an
-- unwritten note apart from a note it is not allowed to read, and does not learn that a
-- distinction exists.

-- ------------------------------------------------------------------------------
-- 4. Grants
-- ------------------------------------------------------------------------------

-- Supabase's default privileges grant ALL on every new public table to anon and authenticated,
-- so the GRANTs add nothing by themselves; the REVOKEs are what make the posture true. No DELETE:
-- a removed player cascades the row away with the rest of the child's records.
GRANT SELECT, INSERT, UPDATE ON public.player_private_notes TO authenticated;
REVOKE ALL ON public.player_private_notes FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.player_private_notes FROM authenticated;
