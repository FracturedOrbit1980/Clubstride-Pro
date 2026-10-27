-- ===============================================================================
-- Clubstride Pro - player feedback, share codes and the shared profile lookup
-- 20261027120000
--
-- The coach rates a player on 17 fixed metrics (1-5 in half steps) and writes a short note.
-- Scores live in JSONB because the metric list belongs to the client: adding an 18th metric
-- later must not need a migration, and the shared profile always reads the keys it knows.
-- A missing key means "not rated yet", which is also how the editor clears a score.
--
-- A public profile is opened with an 8-character code, not an account. The code is a bearer
-- capability for one child's report: 40 bits from an unambiguous alphabet, revocable, and looked
-- up by a SECURITY DEFINER function so anon never gets a table privilege. The function returns
-- that one player's ratings, note and game time - never a squad, an attendance history or
-- anything about another child.
--
-- As with team_settings: the helpers on the applied database live in schema `private`.
-- `public.is_team_staff` does not exist there and fails with 42883.
-- ===============================================================================

-- ------------------------------------------------------------------------------
-- 1. Tables
-- ------------------------------------------------------------------------------

-- team_id is denormalised from players on purpose: every policy below tests it, and a policy
-- that has to look the team up through players re-enters that table's RLS on every row.
CREATE TABLE IF NOT EXISTS public.player_assessments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id    UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  -- { "passing_accuracy": 4, "first_touch": 3.5, ... }; keys are the client's MetricKey values.
  scores       JSONB NOT NULL DEFAULT '{}'::JSONB,
  coach_notes  TEXT,
  -- auth.uid() is the value the INSERT policy trusts; the outbox refuses to send it itself.
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  -- Client timestamp, the last-write-wins version, mirroring matches and attendance.
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,
  CONSTRAINT player_assessments_scores_are_an_object CHECK (jsonb_typeof(scores) = 'object'),
  CONSTRAINT player_assessments_note_length CHECK (coach_notes IS NULL OR length(coach_notes) <= 2000)
);

COMMENT ON COLUMN public.player_assessments.scores IS
  'Metric keys from src/features/coach/player/assessment.ts to half-step ratings 1-5.';

-- One live row per player, rotated in place. A separate history table would let a code holder
-- read every past assessment; the shared profile shows the latest one only.
CREATE TABLE IF NOT EXISTS public.player_share_codes (
  player_id   UUID PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  -- I, O, 0 and 1 are excluded: the code is read off a PDF and typed on a phone.
  code        TEXT NOT NULL UNIQUE,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ,
  CONSTRAINT player_share_codes_shape CHECK (code ~ '^[A-HJ-NP-Z2-9]{8}$')
);

COMMENT ON COLUMN public.player_share_codes.code IS
  'Bearer capability for the public player profile. Rotate by rewriting code; revoke with revoked_at.';

DROP TRIGGER IF EXISTS player_assessments_touch ON public.player_assessments;
CREATE TRIGGER player_assessments_touch BEFORE UPDATE ON public.player_assessments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS player_share_codes_touch ON public.player_share_codes;
CREATE TRIGGER player_share_codes_touch BEFORE UPDATE ON public.player_share_codes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS assessments_player_idx
  ON public.player_assessments (player_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS assessments_team_idx
  ON public.player_assessments (team_id);

-- ------------------------------------------------------------------------------
-- 2. Row level security
-- ------------------------------------------------------------------------------

ALTER TABLE public.player_assessments ENABLE ROW LEVEL SECURITY;

-- Staff see the squad's assessments; a parent sees only their own child's, which is the same
-- line the attendance and fixture policies draw. The guardian test reads player_guardians
-- directly because its own policy already limits a caller to their guardianship row.
DROP POLICY IF EXISTS "assessments_read" ON public.player_assessments;
CREATE POLICY "assessments_read" ON public.player_assessments
  FOR SELECT USING (
    private.is_team_staff(team_id)
    OR EXISTS (
      SELECT 1 FROM public.player_guardians g
      WHERE g.player_id = player_assessments.player_id AND g.user_id = auth.uid()
    )
  );

-- The EXISTS keeps a staff member of team A from filing a rating against team B's player.
-- Columns on the new row are named through the table: an unqualified team_id inside the
-- subquery would bind to players.team_id and make the check trivially true.
DROP POLICY IF EXISTS "assessments_staff_insert" ON public.player_assessments;
CREATE POLICY "assessments_staff_insert" ON public.player_assessments
  FOR INSERT WITH CHECK (
    private.is_team_staff(team_id)
    AND EXISTS (
      SELECT 1 FROM public.players p
      WHERE p.id = player_assessments.player_id
        AND p.team_id = player_assessments.team_id
    )
  );

DROP POLICY IF EXISTS "assessments_staff_update" ON public.player_assessments;
CREATE POLICY "assessments_staff_update" ON public.player_assessments
  FOR UPDATE USING (private.is_team_staff(team_id))
  WITH CHECK (
    private.is_team_staff(team_id)
    AND EXISTS (
      SELECT 1 FROM public.players p
      WHERE p.id = player_assessments.player_id
        AND p.team_id = player_assessments.team_id
    )
  );

ALTER TABLE public.player_share_codes ENABLE ROW LEVEL SECURITY;

-- Staff only. A parent receives the code through the coach's message or the PDF; the app does
-- not need to read it back, and a code sitting in a parent's cache is one more thing to leak.
DROP POLICY IF EXISTS "share_codes_read_staff" ON public.player_share_codes;
CREATE POLICY "share_codes_read_staff" ON public.player_share_codes
  FOR SELECT USING (private.is_team_staff(team_id));

DROP POLICY IF EXISTS "share_codes_staff_insert" ON public.player_share_codes;
CREATE POLICY "share_codes_staff_insert" ON public.player_share_codes
  FOR INSERT WITH CHECK (
    private.is_team_staff(team_id)
    AND EXISTS (
      SELECT 1 FROM public.players p
      WHERE p.id = player_share_codes.player_id
        AND p.team_id = player_share_codes.team_id
    )
  );

-- Rotating rewrites code, revoking sets revoked_at. Both are UPDATEs on the same row.
DROP POLICY IF EXISTS "share_codes_staff_update" ON public.player_share_codes;
CREATE POLICY "share_codes_staff_update" ON public.player_share_codes
  FOR UPDATE USING (private.is_team_staff(team_id))
  WITH CHECK (
    private.is_team_staff(team_id)
    AND EXISTS (
      SELECT 1 FROM public.players p
      WHERE p.id = player_share_codes.player_id
        AND p.team_id = player_share_codes.team_id
    )
  );

-- ------------------------------------------------------------------------------
-- 3. The shared profile lookup
--
-- Runs as the migration owner, so it reads past RLS and returns exactly one child's report to
-- anon. Everything it can return is assembled here rather than by granting the caller SELECT
-- on the tables. Unknown, revoked or malformed codes return NULL, which PostgREST renders as
-- null rather than an error - the screen shows "code not found" either way.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.player_profile_by_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code       TEXT;
  v_share      public.player_share_codes;
  v_player     public.players;
  v_team_name  TEXT;
  v_assessment public.player_assessments;
  v_matches    JSONB;
  v_played     INT;
  v_total      INT;
BEGIN
  -- Normalised the way the client normalises typed input, so PLAYER-24 and player24 agree.
  IF p_code IS NULL OR length(p_code) > 64 THEN
    RETURN NULL;
  END IF;
  v_code := upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'));
  IF v_code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_share
    FROM public.player_share_codes
   WHERE code = v_code AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_player
    FROM public.players
   WHERE id = v_share.player_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT t.name INTO v_team_name FROM public.teams t WHERE t.id = v_player.team_id;

  SELECT * INTO v_assessment
    FROM public.player_assessments
   WHERE player_id = v_player.id AND deleted_at IS NULL
   ORDER BY recorded_at DESC
   LIMIT 1;

  -- The same rules the client applies: completed matches only, every completed match counts
  -- towards the total, a player absent from the line-up played none of it, and minutes past
  -- the final whistle are clamped. Matches with no recorded length keep their raw minutes so a
  -- season logged before durations existed still shows time played.
  WITH completed AS (
    SELECT
      m.id,
      m.title,
      m.opponent_name,
      m.match_date,
      m.duration_seconds,
      CASE
        WHEN m.duration_seconds > 0
          THEN LEAST(coalesce(mp.recorded_seconds, 0), m.duration_seconds)
        ELSE coalesce(mp.recorded_seconds, 0)
      END AS played_seconds
    FROM public.matches m
    LEFT JOIN public.match_players mp
      ON mp.match_id = m.id AND mp.player_id = v_player.id
    WHERE m.team_id = v_player.team_id
      AND m.status = 'completed'
      AND m.deleted_at IS NULL
  )
  SELECT
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'match_id', id,
          'title', title,
          'opponent_name', opponent_name,
          'match_date', match_date,
          'duration_seconds', duration_seconds,
          'played_seconds', played_seconds
        )
        ORDER BY match_date DESC
      ),
      '[]'::JSONB
    ),
    coalesce(sum(played_seconds), 0),
    coalesce(sum(duration_seconds), 0)
  INTO v_matches, v_played, v_total
  FROM completed;

  RETURN jsonb_build_object(
    'player', jsonb_build_object(
      'id', v_player.id,
      'full_name', v_player.full_name,
      'shirt_number', v_player.shirt_number,
      'position_tag', v_player.position_tag,
      'team_name', v_team_name
    ),
    'assessment', CASE
      WHEN v_assessment.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'scores', v_assessment.scores,
        'coach_notes', v_assessment.coach_notes,
        'recorded_at', v_assessment.recorded_at
      )
    END,
    'minutes', jsonb_build_object(
      'matches', v_matches,
      'played_seconds', v_played,
      'total_seconds', v_total
    ),
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.player_profile_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.player_profile_by_code(TEXT) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. Grants
--
-- Supabase's default privileges grant ALL on every new public table to anon and authenticated,
-- so these GRANTs add nothing by themselves; the REVOKEs are what make the posture true. No
-- DELETE: a removed player cascades, and a superseded assessment is tombstoned by UPDATE.
-- ------------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO anon;

GRANT SELECT, INSERT, UPDATE ON public.player_assessments TO authenticated;
REVOKE ALL ON public.player_assessments FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.player_assessments FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON public.player_share_codes TO authenticated;
REVOKE ALL ON public.player_share_codes FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.player_share_codes FROM authenticated;
