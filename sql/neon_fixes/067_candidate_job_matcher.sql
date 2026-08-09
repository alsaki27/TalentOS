-- 067: Audited active-candidate -> recent-job matcher with AE approval gate.

CREATE TABLE IF NOT EXISTS candidate_job_match_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key text NOT NULL UNIQUE,
  trigger_type text NOT NULL DEFAULT 'scheduled'
    CHECK (trigger_type IN ('scheduled', 'manual', 'recovery')),
  mode text NOT NULL DEFAULT 'dry_run'
    CHECK (mode IN ('dry_run', 'ae_review')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'partial_success', 'failed')),
  freshness_days integer NOT NULL DEFAULT 7 CHECK (freshness_days BETWEEN 1 AND 30),
  tier_a_min integer NOT NULL DEFAULT 85,
  tier_b_min integer NOT NULL DEFAULT 70,
  max_recommendations_per_candidate integer NOT NULL DEFAULT 50
    CHECK (max_recommendations_per_candidate BETWEEN 1 AND 50),
  assigned_to_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  candidate_count integer NOT NULL DEFAULT 0,
  job_count integer NOT NULL DEFAULT 0,
  evaluated_count integer NOT NULL DEFAULT 0,
  recommended_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  error_message text,
  processing_token text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS candidate_job_match_runs_created_idx
  ON candidate_job_match_runs(created_at DESC);

ALTER TABLE candidate_job_match_runs ADD COLUMN IF NOT EXISTS processing_token text;

CREATE TABLE IF NOT EXISTS candidate_job_match_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES candidate_job_match_runs(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  base_resume_id uuid NOT NULL REFERENCES base_resumes(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES candidate_resume_search_profiles(id) ON DELETE SET NULL,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  tier text CHECK (tier IN ('A', 'B')),
  outcome text NOT NULL CHECK (outcome IN ('recommended', 'rejected')),
  reason text NOT NULL,
  matched_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  dismissed_term_hits jsonb NOT NULL DEFAULT '[]'::jsonb,
  score_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  hard_gates jsonb NOT NULL DEFAULT '[]'::jsonb,
  job_posted_at timestamptz,
  freshness_cutoff timestamptz NOT NULL,
  review_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (review_status IN ('not_applicable', 'pending', 'approved', 'rejected')),
  reviewed_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  profile_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, candidate_id, job_id)
);

CREATE INDEX IF NOT EXISTS candidate_job_match_decisions_review_idx
  ON candidate_job_match_decisions(review_status, score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS candidate_job_match_decisions_candidate_idx
  ON candidate_job_match_decisions(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS candidate_job_match_decisions_job_idx
  ON candidate_job_match_decisions(job_id, created_at DESC);

-- These columns already exist in some production environments. Keep this
-- deployment idempotent so database state converges everywhere.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS base_resume_id uuid;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS ae_stage text DEFAULT 'in_ai_pipeline';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS ae_stage_updated_at timestamptz;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS ae_stage_updated_by_user_id uuid;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS ae_stage_updated_by_name text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS automation_idempotency_key text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_base_resume_fk') THEN
    ALTER TABLE applications
      ADD CONSTRAINT applications_base_resume_fk
      FOREIGN KEY (base_resume_id) REFERENCES base_resumes(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_ae_stage_updated_by_fk') THEN
    ALTER TABLE applications
      ADD CONSTRAINT applications_ae_stage_updated_by_fk
      FOREIGN KEY (ae_stage_updated_by_user_id) REFERENCES profiles(user_id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS applications_automation_idempotency_idx
  ON applications(automation_idempotency_key)
  WHERE automation_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS applications_base_resume_idx ON applications(base_resume_id);
