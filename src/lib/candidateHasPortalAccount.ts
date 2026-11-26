export function candidateHasPortalAccount(candidate: {
  account_created_at?: string | null;
  last_login_at?: string | null;
  google_sub?: string | null;
  account_email?: string | null;
  password_hash?: string | null;
}) {
  return Boolean(candidate.account_created_at || candidate.last_login_at ||
    candidate.google_sub || (candidate.account_email && candidate.password_hash));
}
