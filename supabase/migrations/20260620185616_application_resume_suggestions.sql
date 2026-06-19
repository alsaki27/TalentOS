-- supabase/migrations/20260620185616_application_resume_suggestions.sql
-- AI-generated resume suggestions with truth-checking.
-- Part of Chunk 7: AI Resume Suggestions + Truth Check.
-- Portable Postgres; no Supabase-specific extensions beyond gen_random_uuid().

BEGIN;

CREATE TABLE IF NOT EXISTS application_resume_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  resume_version_id uuid REFERENCES application_resume_versions(id) ON DELETE SET NULL,
  keyword_id uuid REFERENCES application_job_keywords(id) ON DELETE SET NULL,
  suggestion_type text NOT NULL,
  target_section text NOT NULL,
  target_subsection_id text,
  original_text text,
  proposed_text text NOT NULL,
  ai_reasoning text,
  truth_status text NOT NULL DEFAULT 'unverified',
  truth_check_details text,
  source_evidence text,
  status text NOT NULL DEFAULT 'pending',
  user_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Constraints
  CONSTRAINT application_resume_suggestions_type_check CHECK (
    suggestion_type IN ('content_change', 'format_improvement', 'truth_warning', 'keyword_injection', 'missing_evidence')
  ),
  CONSTRAINT application_resume_suggestions_section_check CHECK (
    target_section IN ('summary', 'skills', 'experience', 'education', 'certifications', 'projects', 'header')
  ),
  CONSTRAINT application_resume_suggestions_truth_check CHECK (
    truth_status IN ('verified', 'unverified', 'fabrication_risk')
  ),
  CONSTRAINT application_resume_suggestions_status_check CHECK (
    status IN ('pending', 'accepted', 'rejected', 'applied')
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_application_resume_suggestions_application_id
  ON application_resume_suggestions(application_id);
CREATE INDEX IF NOT EXISTS idx_application_resume_suggestions_resume_version_id
  ON application_resume_suggestions(resume_version_id);
CREATE INDEX IF NOT EXISTS idx_application_resume_suggestions_keyword_id
  ON application_resume_suggestions(keyword_id);
CREATE INDEX IF NOT EXISTS idx_application_resume_suggestions_status
  ON application_resume_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_application_resume_suggestions_type
  ON application_resume_suggestions(suggestion_type);
CREATE INDEX IF NOT EXISTS idx_application_resume_suggestions_truth_status
  ON application_resume_suggestions(truth_status);
CREATE INDEX IF NOT EXISTS idx_application_resume_suggestions_section_status
  ON application_resume_suggestions(target_section, status);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION update_application_resume_suggestions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_application_resume_suggestions_updated_at ON application_resume_suggestions;
CREATE TRIGGER trigger_application_resume_suggestions_updated_at
  BEFORE UPDATE ON application_resume_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION update_application_resume_suggestions_updated_at();

COMMIT;
