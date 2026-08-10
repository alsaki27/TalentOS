-- Candidate-owned preparation notes. These are private to the candidate and
-- intentionally separate from application_comments, which can contain staff
-- notes and candidate-visible updates.
CREATE TABLE IF NOT EXISTS candidate_application_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  body           text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 5000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS candidate_application_notes_candidate_idx
  ON candidate_application_notes (candidate_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS candidate_application_notes_application_idx
  ON candidate_application_notes (application_id, updated_at DESC);
