-- Candidate form-entry history. No application status or canonical answer is changed.
BEGIN;
CREATE TABLE IF NOT EXISTS candidate_submission_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  instance_name text NOT NULL CHECK (length(instance_name) BETWEEN 1 AND 120),
  recorded_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  extension_key_id uuid REFERENCES extension_api_keys(id) ON DELETE SET NULL,
  question text NOT NULL CHECK (length(question) BETWEEN 1 AND 1000),
  answer text NOT NULL CHECK (length(answer) <= 100000),
  page_url text NOT NULL CHECK (length(page_url) <= 4096),
  page_title text NOT NULL CHECK (length(page_title) <= 1000),
  field_key text NOT NULL CHECK (length(field_key) <= 1000),
  field_type text NOT NULL CHECK (length(field_type) <= 80),
  event_type text NOT NULL CHECK (event_type IN ('input','change','focusout','submit')),
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  content_hash text NOT NULL,
  UNIQUE(instance_id, event_id)
);
CREATE INDEX IF NOT EXISTS candidate_submission_records_candidate_received_idx
  ON candidate_submission_records(candidate_id, received_at DESC, id DESC);
COMMENT ON TABLE candidate_submission_records IS
  'Observed form entries from an opted-in browser extension; not proof of successful application submission.';
COMMIT;
