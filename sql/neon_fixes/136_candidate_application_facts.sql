-- Application facts are candidate-owned, explicitly reviewed, and revisioned.
-- A newer draft supersedes the prior revision for worker resolution.
CREATE TABLE IF NOT EXISTS candidate_application_facts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  section text NOT NULL CHECK (char_length(section) BETWEEN 1 AND 80),
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 400),
  question_key text NOT NULL CHECK (char_length(question_key) > 0),
  value_kind text NOT NULL CHECK (value_kind IN ('text','boolean','integer','decimal','date','option')),
  disposition text NOT NULL CHECK (disposition IN ('known','unknown','declined')),
  answer_value jsonb,
  source_kind text NOT NULL CHECK (source_kind IN ('profile','candidate_attested','document')),
  source_ref text NOT NULL CHECK (char_length(source_ref) BETWEEN 1 AND 300),
  expires_at timestamptz,
  review_state text NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft','approved','revoked')),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  revoked_by_user_id uuid,
  revoked_at timestamptz,
  PRIMARY KEY (id, revision),
  CHECK (
    (disposition <> 'known' AND answer_value IS NULL)
    OR (disposition = 'known' AND answer_value IS NOT NULL AND (
      (value_kind IN ('text','date','option') AND jsonb_typeof(answer_value) = 'string')
      OR (value_kind = 'boolean' AND jsonb_typeof(answer_value) = 'boolean')
      OR (value_kind IN ('integer','decimal') AND jsonb_typeof(answer_value) = 'number')
    ))
  ),
  CHECK (review_state <> 'approved' OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK (review_state <> 'revoked' OR (revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS candidate_application_facts_candidate_revision_idx
  ON candidate_application_facts(candidate_id, id, revision DESC);
