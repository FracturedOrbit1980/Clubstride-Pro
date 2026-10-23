-- ==============================================================================
-- Clubstride Pro - Pro unlocked on registration
--
-- Product rule (2026-10-23): registering unlocks Pro, and the yearly subscription is
-- what keeps it unlocked. Tier stays server-owned: guard_user_columns() still refuses
-- any tier change from a normal client, so a lapsed subscription is downgraded by the
-- billing integration with the service role, never by the app.
--
-- Supersedes the "'lite' at signup" behaviour in the baseline (section 1 comment and
-- handle_new_user). auth.users was empty when this migration was authored, so there is
-- nothing to backfill.
-- ==============================================================================

ALTER TABLE public.users ALTER COLUMN tier SET DEFAULT 'pro';

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
    'pro',
    NULLIF(trim(NEW.raw_user_meta_data ->> 'first_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data ->> 'last_name'), '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
