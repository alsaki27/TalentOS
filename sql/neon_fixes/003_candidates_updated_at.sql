-- ============================================================
-- Add missing updated_at to candidates and resumes tables
--
-- Multiple API routes (resume upload, photo upload, candidate PATCH)
-- use UPDATE ... SET updated_at = NOW() against the candidates table,
-- but the Neon schema was created without this column. This causes
-- "column updated_at does not exist" errors on every candidate mutation.
--
-- Also adds updated_at to resumes for consistency (the parse-markitdown
-- route updates parsed_json without touching timestamps, but having the
-- column present means future code can use it safely).
--
-- Every statement is idempotent (ADD COLUMN IF NOT EXISTS) so this is
-- safe to run on every deploy even if the columns already exist.
-- ============================================================

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE resumes
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
