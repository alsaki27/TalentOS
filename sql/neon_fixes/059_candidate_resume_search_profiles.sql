-- Candidate/base-resume job-search baseline.
-- This is intentionally separate from the ingestion agent so AEs can review
-- and approve the search contract before automation consumes it.
CREATE TABLE IF NOT EXISTS candidate_resume_search_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  base_resume_id UUID NOT NULL REFERENCES base_resumes(id) ON DELETE CASCADE,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  additional_rules TEXT NOT NULL DEFAULT '',
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT candidate_resume_search_profiles_resume_unique UNIQUE (base_resume_id)
);

CREATE INDEX IF NOT EXISTS candidate_resume_search_profiles_candidate_idx
  ON candidate_resume_search_profiles(candidate_id);
