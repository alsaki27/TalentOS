BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS application_resume_pdf_refresh_jobs (
  resume_version_id uuid PRIMARY KEY REFERENCES application_resume_versions(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES application_ai_workflows(id) ON DELETE CASCADE,
  revision text NOT NULL,
  editor_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'complete', 'blocked', 'superseded')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS application_resume_pdf_refresh_due
  ON application_resume_pdf_refresh_jobs(next_attempt_at) WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS application_resume_pdf_archive_jobs (
  export_id uuid PRIMARY KEY REFERENCES application_resume_exports(id) ON DELETE CASCADE,
  temporary_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'cleanup', 'complete', 'blocked')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS application_resume_pdf_archive_due
  ON application_resume_pdf_archive_jobs(next_attempt_at) WHERE state IN ('pending', 'cleanup');

ALTER TABLE applications ADD COLUMN IF NOT EXISTS submitted_resume_export_id uuid;
ALTER TABLE application_resume_versions ADD COLUMN IF NOT EXISTS pdf_refresh_state text;
ALTER TABLE application_resume_versions ADD COLUMN IF NOT EXISTS pdf_refresh_error text;
ALTER TABLE application_resume_exports ADD COLUMN IF NOT EXISTS pdf_archive_state text;

CREATE OR REPLACE FUNCTION queue_saved_resume_pdf_refresh() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.updated_source IS DISTINCT FROM 'human_falood_studio_save'
    OR NEW.updated_by_user_id IS NULL
    OR (NEW.content IS NOT DISTINCT FROM OLD.content
      AND NEW.formatting IS NOT DISTINCT FROM OLD.formatting
      AND NEW.generated_text IS NOT DISTINCT FROM OLD.generated_text) THEN
    RETURN NEW;
  END IF;

  INSERT INTO application_resume_pdf_refresh_jobs
    (resume_version_id, application_id, workflow_id, revision, editor_id)
  SELECT NEW.id, a.id, w.id, NEW.id::text || ':' ||
    encode(sha256(convert_to(jsonb_build_array(NEW.content, NEW.formatting, NEW.generated_text)::text, 'UTF8')), 'hex'),
    NEW.updated_by_user_id
  FROM applications a JOIN application_ai_workflows w ON w.id = a.ai_workflow_id
  WHERE a.id = NEW.application_id AND a.tailored_resume_version_id = NEW.id AND NEW.workflow_id = w.id
    AND w.status = 'completed' AND w.config_snapshot->>'pipelineVariant' = 'resume_evidence_v2'
    AND COALESCE(a.application_stage, a.ae_stage) IN ('ready_for_application', 'applied')
    AND a.review_status IS DISTINCT FROM 'changes_requested'
    AND (EXISTS (
      SELECT 1 FROM application_resume_exports x
      WHERE OLD.status = 'approved' AND x.id::text = OLD.release_receipt->>'exportId'
        AND x.application_id = a.id AND x.resume_version_id = NEW.id
        AND x.export_type = 'pdf' AND x.status = 'created'
        AND x.content_sha256 = OLD.release_receipt->>'pdfHash'
    ) OR EXISTS (
      SELECT 1 FROM application_resume_pdf_refresh_jobs r
      WHERE r.resume_version_id = NEW.id AND r.application_id = a.id AND r.workflow_id = w.id
        AND r.state IN ('pending', 'blocked')
    ))
  ON CONFLICT (resume_version_id) DO UPDATE SET
    revision = EXCLUDED.revision, editor_id = EXCLUDED.editor_id, state = 'pending',
    attempts = 0, next_attempt_at = NOW(), last_error = NULL, updated_at = NOW();
  IF FOUND THEN
    UPDATE application_resume_versions SET pdf_refresh_state = 'pending', pdf_refresh_error = NULL WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS application_resume_pdf_refresh_after_studio_save ON application_resume_versions;
CREATE TRIGGER application_resume_pdf_refresh_after_studio_save
  AFTER UPDATE OF content, formatting, generated_text ON application_resume_versions
  FOR EACH ROW EXECUTE FUNCTION queue_saved_resume_pdf_refresh();

CREATE OR REPLACE FUNCTION remember_submitted_resume_export() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(NEW.application_stage, NEW.ae_stage) = 'applied'
    AND (COALESCE(OLD.application_stage, OLD.ae_stage) IS DISTINCT FROM 'applied'
      OR OLD.applied_at IS NULL) THEN
    SELECT x.id INTO NEW.submitted_resume_export_id
    FROM application_resume_versions v JOIN application_resume_exports x
      ON x.id::text = v.release_receipt->>'exportId'
      AND x.resume_version_id = v.id AND x.application_id = NEW.id
      AND x.status = 'created' AND x.export_type = 'pdf'
      AND x.content_sha256 = v.release_receipt->>'pdfHash'
    WHERE v.id = NEW.tailored_resume_version_id AND v.workflow_id = NEW.ai_workflow_id AND v.status = 'approved';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS application_remember_submitted_resume_export ON applications;
CREATE TRIGGER application_remember_submitted_resume_export
  BEFORE UPDATE OF application_stage, ae_stage, applied_at ON applications
  FOR EACH ROW EXECUTE FUNCTION remember_submitted_resume_export();

COMMIT;
