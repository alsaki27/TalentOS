BEGIN;
CREATE TABLE IF NOT EXISTS candidate_signed_contracts (
 id uuid PRIMARY KEY,
 candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
 agreement_version text NOT NULL,
 privacy_notice_version text NOT NULL,
 agreement_text text NOT NULL,
 agreement_sha256 text NOT NULL,
 signer_name text NOT NULL,
 signer_email text NOT NULL,
 signature jsonb NOT NULL,
 signing_date date NOT NULL,
 signed_at timestamptz NOT NULL,
 pdf_base64 text NOT NULL CHECK(length(pdf_base64) BETWEEN 1 AND 4000000),
 pdf_sha256 text NOT NULL,
 UNIQUE(candidate_id,agreement_version,privacy_notice_version)
);
CREATE TABLE IF NOT EXISTS candidate_contract_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 contract_id uuid NOT NULL REFERENCES candidate_signed_contracts(id) ON DELETE CASCADE,
 recipient text NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 sent_at timestamptz,
 last_error text,
 UNIQUE(contract_id,recipient)
);
CREATE INDEX IF NOT EXISTS candidate_contract_deliveries_pending_idx ON candidate_contract_deliveries(next_attempt_at) WHERE sent_at IS NULL;
COMMIT;
