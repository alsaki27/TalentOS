CREATE TABLE IF NOT EXISTS ats_score_evaluations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    resume_id uuid NOT NULL,
    resume_type text NOT NULL CHECK (resume_type IN ('base', 'tailored')),
    job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
    overall_score integer NOT NULL,
    structured_extraction jsonb,
    deterministic_breakdown jsonb,
    narrative_feedback jsonb,
    parseability_flags jsonb,
    prompt_version text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ats_score_evaluations_candidate_idx ON ats_score_evaluations (candidate_id);
CREATE INDEX IF NOT EXISTS ats_score_evaluations_job_idx ON ats_score_evaluations (job_id);
