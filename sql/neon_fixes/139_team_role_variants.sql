-- 137: Preserve staff sub-role labels independently from their current
-- permission profile. Existing profiles keep their current role and access.
BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role_variant text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass
       AND conname = 'profiles_role_variant_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_role_variant_check
      CHECK (
        role_variant IS NULL
        OR (
          role IN ('manager', 'application_engineer')
          AND role_variant IN (
            'co_manager',
            'application_engineer_manager_reviewer',
            'application_engineer_reviewer',
            'application_engineer_grunter'
          )
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN profiles.role_variant IS
  'Optional named staff sub-role. The effective access profile is resolved from the role variant in src/lib/auth-edge.ts; profiles.role remains a compatible coarse role for existing queries.';

COMMIT;
