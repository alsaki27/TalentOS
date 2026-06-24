-- supabase/migrations/20260619185616_application_job_keywords.sql
-- Application-level JD keyword extraction + approval workflow.
-- Part of Chunk 6: JD Keyword Approval + Evidence Mapping.
-- Portable Postgres; no Supabase-specific extensions beyond gen_random_uuid().

BEGIN;

CREATE TABLE IF NOT EXISTS application_job_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  keyword text NOT NULL,
  normalized_keyword text NOT NULL,
  category text NOT NULL,
  importance text NOT NULL DEFAULT 'medium',
  source text NOT NULL DEFAULT 'ai_jd_analysis',
  status text NOT NULL DEFAULT 'pending',
  ai_reason text,
  user_reason text,
  evidence_summary text,
  evidence_status text NOT NULL DEFAULT 'unmapped',
  created_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Constraints
  CONSTRAINT application_job_keywords_importance_check CHECK (
    importance IN ('low', 'medium', 'high', 'critical')
  ),
  CONSTRAINT application_job_keywords_category_check CHECK (
    category IN ('skill', 'tool', 'responsibility', 'certification', 'education', 'experience', 'domain', 'soft_skill', 'visa', 'red_flag', 'other')
  ),
  CONSTRAINT application_job_keywords_source_check CHECK (
    source IN ('ai_jd_analysis', 'manual', 'imported')
  ),
  CONSTRAINT application_job_keywords_status_check CHECK (
    status IN ('pending', 'approved', 'rejected', 'needs_evidence')
  ),
  CONSTRAINT application_job_keywords_evidence_status_check CHECK (
    evidence_status IN ('unmapped', 'mapped', 'weak', 'missing')
  ),
  CONSTRAINT application_job_keywords_unique_per_app UNIQUE (application_id, normalized_keyword)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_application_job_keywords_application_id
  ON application_job_keywords(application_id);
CREATE INDEX IF NOT EXISTS idx_application_job_keywords_job_id
  ON application_job_keywords(job_id);
CREATE INDEX IF NOT EXISTS idx_application_job_keywords_status
  ON application_job_keywords(status);
CREATE INDEX IF NOT EXISTS idx_application_job_keywords_normalized_keyword
  ON application_job_keywords(normalized_keyword);
CREATE INDEX IF NOT EXISTS idx_application_job_keywords_evidence_status
  ON application_job_keywords(evidence_status);
CREATE INDEX IF NOT EXISTS idx_application_job_keywords_category_importance
  ON application_job_keywords(category, importance);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION update_application_job_keywords_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_application_job_keywords_updated_at ON application_job_keywords;
CREATE TRIGGER trigger_application_job_keywords_updated_at
  BEFORE UPDATE ON application_job_keywords
  FOR EACH ROW
  EXECUTE FUNCTION update_application_job_keywords_updated_at();

COMMIT;
