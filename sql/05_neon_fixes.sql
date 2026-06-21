-- ============================================================
-- TalentOS Neon Fixes — Missing sequence and columns
-- Run this against Neon after deploying the app.
-- ============================================================

-- Fix 1: Application number sequence (used by generateAppNumbers in applicationsRepository.ts)
CREATE SEQUENCE IF NOT EXISTS applications_app_number_seq START WITH 10000;

-- Fix 2: Add app_number column to applications if missing
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS app_number INTEGER UNIQUE;

-- Set default after column exists to avoid error on existing rows
ALTER TABLE applications
  ALTER COLUMN app_number SET DEFAULT nextval('applications_app_number_seq');

-- Fix 3: Add updated_at to applications (referenced in ApplicationRow interface)
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Fix 4: Add created_at to applications if truly missing (code references it, schema may have applied_at instead)
-- NOTE: applications already has applied_at DEFAULT now(). We add created_at as an alias for compatibility.
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Fix 5: backfill existing rows so they get app_numbers
-- Only run if there are rows with NULL app_number
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM applications WHERE app_number IS NULL
  ) THEN
    UPDATE applications
    SET app_number = nextval('applications_app_number_seq')
    WHERE app_number IS NULL;
  END IF;
END $$;
