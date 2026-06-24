-- Harden candidate magic links and add application proof artifacts for AE work.

alter table candidates
  add column if not exists portal_token_expires_at timestamptz,
  add column if not exists portal_token_revoked_at timestamptz;

alter table applications
  add column if not exists proof_url text,
  add column if not exists proof_filename text,
  add column if not exists proof_uploaded_at timestamptz,
  add column if not exists proof_uploaded_by_user_id uuid references profiles(user_id) on delete set null;

create index if not exists candidates_portal_token_expiry_idx on candidates (portal_token_expires_at);
create index if not exists applications_proof_uploaded_by_idx on applications (proof_uploaded_by_user_id);
