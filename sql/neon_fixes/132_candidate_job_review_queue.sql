-- 132: Human-review gate shared by Scheduled Candidate Logging and the
-- job-capture extension's "assign" action. Both currently create a real
-- `applications` row (and start the AI resume pipeline) with no human ever
-- seeing the pair first. This table is where a pair waits until an
-- admin/manager approves or rejects it; approval is the only thing that
-- creates the real application from here on.

CREATE TABLE IF NOT EXISTS candidate_job_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('scheduled_logging', 'extension')),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  base_resume_id uuid REFERENCES base_resumes(id) ON DELETE SET NULL,
  -- Lane-breadth: every candidate resume scored against this job, not just
  -- the primary pick, so a reviewer can see and override the choice.
  alternate_resumes jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Stage 1 (deterministic keyword/ATS). Always populated for both sources -
  -- extension assigns now run the same scoring, not a bypass of it.
  ats_score integer CHECK (ats_score IS NULL OR ats_score BETWEEN 0 AND 100),
  -- Stage 2 (AI eligibility/fit tiering). ai_status tracks whether it ran at
  -- all, independent of the tier result, so an AI outage never blocks the
  -- pair from reaching review - it just shows up ATS-only.
  ai_status text NOT NULL DEFAULT 'pending' CHECK (ai_status IN ('pending', 'scored', 'failed')),
  ai_tier text CHECK (ai_tier IS NULL OR ai_tier IN ('strong', 'adjacent', 'stretch')),
  ai_score integer CHECK (ai_score IS NULL OR ai_score BETWEEN 0 AND 100),
  ai_reason text,
  ai_failure_reason text,
  -- Eligibility concerns (citizenship/clearance/license/sponsorship) are
  -- shown as warnings on the item, never used to silently exclude it from
  -- the queue - the reviewer decides with the flag in front of them.
  hard_gates jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  priority text NOT NULL DEFAULT 'default' CHECK (priority IN ('high', 'default', 'low')),
  assigned_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  assigned_to_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  assignment_note text,
  assignment_due_at date,
  reviewed_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  -- Traceability back to the originating Scheduled Logging decision, when
  -- source = 'scheduled_logging'. NULL for extension-sourced rows.
  source_decision_id uuid REFERENCES scheduled_candidate_logging_decisions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- The actual global-dedup/no-resubmit enforcement: a pair can only ever
  -- have one row here, regardless of status.
  UNIQUE (candidate_id, job_id)
);
CREATE INDEX IF NOT EXISTS candidate_job_review_queue_status_idx
  ON candidate_job_review_queue(status, created_at DESC);
CREATE INDEX IF NOT EXISTS candidate_job_review_queue_job_idx
  ON candidate_job_review_queue(job_id);

-- scheduled_candidate_logging_decisions gains 'pending_review' - a Stage-1
-- pass now queues for human review instead of silently auto-creating an
-- application ('matched'/'application_created' stay in the enum for
-- historical rows but are no longer written going forward).
ALTER TABLE scheduled_candidate_logging_decisions DROP CONSTRAINT IF EXISTS scheduled_candidate_logging_decisions_status_check;
ALTER TABLE scheduled_candidate_logging_decisions ADD CONSTRAINT scheduled_candidate_logging_decisions_status_check
  CHECK (status IN (
    'pending', 'matched', 'below_threshold', 'ineligible',
    'existing_application', 'no_approved_resume', 'description_unavailable',
    'ai_failed', 'application_created', 'pending_review'
  ));

-- Stage 1 moves from an 85%-pass hard gate to a low noise floor (the real
-- fit judgment is now Stage 2 + the human reviewer, not a keyword cutoff).
ALTER TABLE scheduled_candidate_logging_config ALTER COLUMN match_threshold SET DEFAULT 30;
UPDATE scheduled_candidate_logging_config SET match_threshold = 30 WHERE match_threshold = 85;
COMMENT ON COLUMN scheduled_candidate_logging_config.match_threshold IS
  'Stage-1 deterministic keyword/ATS floor (0-100): a pure noise filter controlling which pairs are worth an AI call, not a fit-quality pass bar. Default lowered 85->30 in migration 132 - fit quality is now Stage 2 + the human reviewer''s job.';

-- Batch size/cadence raised to the configured ceiling now that approval, not
-- auto-creation, is the gate - higher throughput just means a fuller review
-- queue, not more uncontrolled downstream AI-pipeline spend.
ALTER TABLE scheduled_candidate_logging_config ALTER COLUMN jobs_per_run SET DEFAULT 100;
ALTER TABLE scheduled_candidate_logging_config ALTER COLUMN ai_calls_per_run SET DEFAULT 200;
ALTER TABLE scheduled_candidate_logging_config ALTER COLUMN max_applications_per_run SET DEFAULT 100;
UPDATE scheduled_candidate_logging_config SET jobs_per_run = 100, ai_calls_per_run = 200, max_applications_per_run = 100
  WHERE jobs_per_run = 25 AND ai_calls_per_run = 25 AND max_applications_per_run = 25;
COMMENT ON COLUMN scheduled_candidate_logging_config.max_applications_per_run IS
  'Max items queued for human review per run (migration 132 - this feature no longer auto-creates applications, so this caps review-queue inserts, not applications).';
