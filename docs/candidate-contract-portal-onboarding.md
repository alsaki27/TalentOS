# Candidate contract and portal onboarding

This feature adds a contract-status field, private contract uploads, and a required agreement/SSN-choice step for candidates marked as having no contract.

## Before enabling it

1. Review and apply `sql/neon_fixes/117_candidate_contracts_and_portal_onboarding.sql` to the intended database. This is the only schema change required. It backfills existing candidates to `has_contract = true`, so their current portal access remains unchanged.
2. Create a separate R2 bucket for candidate agreements. Keep public access and custom public domains disabled. Configure `R2_CANDIDATE_CONTRACTS_BUCKET_NAME` to that bucket name; it must differ from `R2_BUCKET_NAME`. The app stores only generated object keys in the database and streams files through manager-authorized API routes.
3. Generate a 32-byte AES key, for example with `openssl rand -base64 32`. Set it locally as `CANDIDATE_SSN_ENCRYPTION_KEY` and in GitHub Actions as a secret with the same name. Keep a secure backup: existing SSN ciphertext cannot be decrypted if this key is lost or replaced.
4. Set the GitHub Actions repository variable `R2_CANDIDATE_CONTRACTS_BUCKET_NAME` to the private bucket name so deployment passes it to the Worker.

Until the private bucket is configured, contract upload/download fails closed. Until the encryption key is configured, a no-contract candidate cannot submit SSN onboarding. The full SSN is never requested or stored.

## Runtime behavior

- `has_contract` defaults to true for existing candidates. Creating a candidate through `/api/candidates` requires an explicit Yes/No choice.
- The staff profile's Contract tab shows status and lets managers upload PDF, DOC, and DOCX agreement files. Uploading a signed document marks the candidate as having a contract. Contract files are private and manager-only.
- A no-contract candidate can authenticate, but cannot access candidate portal pages or data APIs until they scroll through the current agreement, accept both required checkboxes, and choose whether they have an SSN. If Yes, only four digits are accepted.
- Terms and privacy versions are recorded with database timestamps. The agreement copy is derived from the supplied PDF with candidate-specific fields and signature pages removed.
- Last-four digits use AES-256-GCM with a candidate-specific authentication value. The ciphertext is stored separately from `candidates` and never returned by portal or staff APIs. A future identity-verification integration can use `decryptCandidateSsnLast4` from server-only code after its access and consent requirements are implemented.
- When the agreement text changes, update `CANDIDATE_AGREEMENT_VERSION`. When the data-handling notice changes, update `CANDIDATE_PRIVACY_NOTICE_VERSION`; candidates must re-accept the new versions.

No schema migration or deployment has been run as part of this code change.

## While migration 117 is pending

- The staff candidate list and profile treat legacy candidates as `has_contract = true`, matching the backfill rule, so existing candidates remain visible.
- Staff candidate creation marked Yes remains compatible with the old schema. Creating a candidate marked No, changing a candidate's contract status, contract uploads, and no-contract onboarding require migration 117; those actions return a setup error rather than silently losing the selected state.
- Public candidate API clients that omit `has_contract` retain the legacy Yes default. Clients may send an explicit value once the migration is applied.
