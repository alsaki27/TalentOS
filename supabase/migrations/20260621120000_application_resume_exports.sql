-- supabase/migrations/20260621120000_application_resume_exports.sql
-- Export history tracking for resume drafts.
-- Part of Chunk 9: DOCX/PDF Export + Final Resume Packet Formatting.
-- Portable Postgres; no Supabase-specific extensions beyond gen_random_uuid().

BEGIN;

CREATE TABLE IF NOT EXISTS application_resume_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  resume_version_id uuid NOT NULL REFERENCES application_resume_versions(id) ON DELETE CASCADE,
  export_type text NOT NULL,
  file_name text NOT NULL,
  file_path text,
  storage_provider text,
  file_size_bytes integer,
  status text NOT NULL DEFAULT 'created',
  error text,
  created_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),

  -- Constraints
  CONSTRAINT application_resume_exports_type_check CHECK (
    export_type IN ('docx', 'pdf', 'markdown', 'text')
  ),
  CONSTRAINT application_resume_exports_status_check CHECK (
    status IN ('created', 'failed', 'deleted')
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_application_resume_exports_application_id
  ON application_resume_exports(application_id);
CREATE INDEX IF NOT EXISTS idx_application_resume_exports_resume_version_id
  ON application_resume_exports(resume_version_id);
CREATE INDEX IF NOT EXISTS idx_application_resume_exports_export_type
  ON application_resume_exports(export_type);
CREATE INDEX IF NOT EXISTS idx_application_resume_exports_created_at
  ON application_resume_exports(created_at);

COMMIT;
