ALTER TABLE application_resume_exports
  ADD COLUMN IF NOT EXISTS content_sha256 text,
  ADD COLUMN IF NOT EXISTS storage_url text,
  ADD COLUMN IF NOT EXISTS storage_item_id text,
  ADD COLUMN IF NOT EXISTS candidate_name_snapshot text,
  ADD COLUMN IF NOT EXISTS company_name_snapshot text,
  ADD COLUMN IF NOT EXISTS job_title_snapshot text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS uq_application_resume_exports_exact_pdf
  ON application_resume_exports(application_id, resume_version_id, export_type, content_sha256)
  WHERE content_sha256 IS NOT NULL AND status <> 'deleted';

CREATE INDEX IF NOT EXISTS idx_application_resume_exports_latest_pdf
  ON application_resume_exports(application_id, export_type, created_at DESC)
  WHERE status = 'created';
