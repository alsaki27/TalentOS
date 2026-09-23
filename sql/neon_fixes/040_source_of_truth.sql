-- One row per candidate. UNIQUE constraint on candidate_id.
CREATE TABLE IF NOT EXISTS candidate_source_of_truth (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          UUID NOT NULL UNIQUE
                          REFERENCES candidates(id) ON DELETE CASCADE,
  -- Skills extracted from the base resume. Managed by the service.
  confirmed_skills      JSONB NOT NULL DEFAULT '[]',
  -- AI suggestions with their per-candidate accept/decline state.
  -- Shape: { skill: string, category: string, reason: string,
  --          confidence: "high"|"medium", status: "pending"|"accepted"|"rejected" }[]
  pending_skills        JSONB NOT NULL DEFAULT '[]',
  -- FK to the base_resume the last parse was run against.
  parsed_from_resume_id UUID REFERENCES base_resumes(id) ON DELETE SET NULL,
  last_parsed_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sot_candidate_id
  ON candidate_source_of_truth(candidate_id);
