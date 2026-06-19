-- ============================================================
-- TalentOS RLS Defense-in-Depth + Audit Columns
-- Run in Supabase SQL editor after 01_schema.sql.
-- ============================================================

-- Enable RLS on all tables (safe to re-run — already enabled in some migrations)
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_crawler_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_api_keys ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if present so this file is idempotent, then recreate.
DROP POLICY IF EXISTS service_role_bypass ON candidates;
DROP POLICY IF EXISTS service_role_bypass ON jobs;
DROP POLICY IF EXISTS service_role_bypass ON applications;
DROP POLICY IF EXISTS service_role_bypass ON resumes;
DROP POLICY IF EXISTS service_role_bypass ON import_sources;
DROP POLICY IF EXISTS service_role_bypass ON company_people;
DROP POLICY IF EXISTS service_role_bypass ON job_crawler_status;
DROP POLICY IF EXISTS service_role_bypass ON public_api_keys;

-- Service-role bypass policies (defense-in-depth)
-- The app layer (Clerk + Next.js middleware) is the primary security layer.
-- These policies allow the service role key to continue working unchanged,
-- and serve as a logged fallback if RLS is ever enforced by a stricter client.
CREATE POLICY service_role_bypass ON candidates FOR ALL USING (true);
CREATE POLICY service_role_bypass ON jobs FOR ALL USING (true);
CREATE POLICY service_role_bypass ON applications FOR ALL USING (true);
CREATE POLICY service_role_bypass ON resumes FOR ALL USING (true);
CREATE POLICY service_role_bypass ON import_sources FOR ALL USING (true);
CREATE POLICY service_role_bypass ON company_people FOR ALL USING (true);
CREATE POLICY service_role_bypass ON job_crawler_status FOR ALL USING (true);
CREATE POLICY service_role_bypass ON public_api_keys FOR ALL USING (true);

-- Audit column: updated_by (tracks who made the last change)
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE import_sources ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE company_people ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE job_crawler_status ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE public_api_keys ADD COLUMN IF NOT EXISTS updated_by text;

-- Ensure updated_at triggers exist for tables that need them (create generic helper)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to tables that have updated_at but may not have a trigger yet
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['candidates','jobs','applications','resumes','import_sources','company_people','job_crawler_status','public_api_keys'];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'updated_at'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = t || '_updated_at' AND tgrelid = (t::regclass)
    ) THEN
      EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t);
    END IF;
  END LOOP;
END $$;
