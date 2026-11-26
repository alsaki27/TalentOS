BEGIN;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS contract_terms_version text;
CREATE TABLE IF NOT EXISTS candidate_agreement_terms (
  candidate_id uuid PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  runs jsonb NOT NULL CHECK (jsonb_typeof(runs) = 'array')
);
COMMIT;
