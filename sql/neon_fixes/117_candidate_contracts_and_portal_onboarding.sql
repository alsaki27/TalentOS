-- Candidate contract status, private file metadata, and required portal agreement.
-- Existing candidates are explicitly treated as having a contract, as requested.

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS has_contract boolean DEFAULT TRUE;

UPDATE candidates
   SET has_contract = TRUE
 WHERE has_contract IS NULL;

ALTER TABLE candidates
  ALTER COLUMN has_contract SET DEFAULT TRUE,
  ALTER COLUMN has_contract SET NOT NULL;

CREATE TABLE IF NOT EXISTS candidate_contract_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  filename text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS candidate_contract_files_candidate_created_idx
  ON candidate_contract_files (candidate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS candidate_portal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  agreement_version text NOT NULL,
  terms_accepted boolean NOT NULL CHECK (terms_accepted IS TRUE),
  agreement_scrolled_to_end boolean NOT NULL CHECK (agreement_scrolled_to_end IS TRUE),
  terms_accepted_at timestamptz NOT NULL DEFAULT now(),
  privacy_notice_version text NOT NULL,
  data_processing_consent boolean NOT NULL CHECK (data_processing_consent IS TRUE),
  privacy_notice_accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, agreement_version, privacy_notice_version)
);

CREATE TABLE IF NOT EXISTS candidate_ssn_records (
  candidate_id uuid PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  has_ssn boolean NOT NULL,
  last4_ciphertext text,
  privacy_notice_version text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_ssn_records_last4_state_check
    CHECK ((has_ssn IS TRUE AND last4_ciphertext IS NOT NULL) OR (has_ssn IS FALSE AND last4_ciphertext IS NULL))
);
