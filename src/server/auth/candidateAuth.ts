// src/server/auth/candidateAuth.ts
// Candidate portal session handling. Fully separate from src/lib/auth.ts (staff),
// its own cookie and JWT `type: "candidate"` marker, its own table (candidates,
// not profiles). Nothing here is imported by, or touches, the job-application
// pipeline (applications/jobs/resumes/AI routes) — read-only lookups against
// candidates only.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createJWT, verifyJWT } from "@/server/auth/jwt";
import { queryOne, execute } from "@/server/db/neon";
import { CANDIDATE_AGREEMENT_VERSION, CANDIDATE_PRIVACY_NOTICE_VERSION } from "@/lib/candidatePortalAgreementVersion";

export const CANDIDATE_TOKEN_COOKIE = "skarion_candidate_token";
export const CANDIDATE_OAUTH_STATE_COOKIE = "skarion_candidate_oauth_state";
export const CANDIDATE_MFA_PENDING_COOKIE = "skarion_candidate_mfa_pending";

export interface CandidateAccount {
  id: string;
  name: string;
  email: string | null;
  account_email: string | null;
  google_sub: string | null;
  password_hash: string | null;
  account_created_at: string | null;
  has_contract?: boolean;
  onboarding_complete?: boolean;
}

export async function findCandidateByLoginEmail(email: string) {
  return queryOne<CandidateAccount>(
    `SELECT id, name, email, account_email, google_sub, password_hash, account_created_at
     FROM candidates WHERE LOWER(account_email) = $1`,
    [email.toLowerCase()]
  );
}

export async function findCandidateByGoogleSub(sub: string) {
  return queryOne<CandidateAccount>(
    `SELECT id, name, email, account_email, google_sub, password_hash, account_created_at
     FROM candidates WHERE google_sub = $1`,
    [sub]
  );
}

export async function findCandidateByPortalToken(token: string) {
  return queryOne<CandidateAccount & { portal_token_expires_at: string | null; portal_token_revoked_at: string | null }>(
    `SELECT id, name, email, account_email, google_sub, password_hash, account_created_at,
            portal_token_expires_at, portal_token_revoked_at
     FROM candidates WHERE portal_token = $1`,
    [token]
  );
}

export async function findCandidateById(id: string) {
  return queryOne<CandidateAccount>(
    `SELECT c.id, c.name, c.email, c.account_email, c.google_sub, c.password_hash, c.account_created_at,
            c.has_contract,
            (c.has_contract OR EXISTS (
              SELECT 1 FROM candidate_portal_acceptances a
               WHERE a.candidate_id = c.id
                 AND a.agreement_version = $2
                 AND a.privacy_notice_version = $3
            )) AS onboarding_complete
       FROM candidates c WHERE c.id = $1`,
    [id, CANDIDATE_AGREEMENT_VERSION, CANDIDATE_PRIVACY_NOTICE_VERSION]
  );
}

export async function createCandidateAuthResponse(candidate: { id: string; account_email: string | null }, redirectTo?: string) {
  const mfa = await queryOne<{ enabled_at: string | null }>("SELECT enabled_at FROM candidate_mfa_settings WHERE candidate_id = $1", [candidate.id]);
  if (mfa?.enabled_at) {
    const pending = await createJWT({ user_id: candidate.id, email: candidate.account_email, role: "candidate", type: "candidate", mfa_pending: true });
    const secure = process.env.NODE_ENV === "production";
    const response = redirectTo
      ? NextResponse.redirect(new URL("/portal/login?mfa=1", redirectTo).toString())
      : NextResponse.json({ ok: true, mfaRequired: true });
    response.cookies.set(CANDIDATE_MFA_PENDING_COOKIE, pending, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 600 });
    return response;
  }
  return createCandidateAuthResponseAfterMfa(candidate, redirectTo);
}

export async function createCandidateAuthResponseAfterMfa(candidate: { id: string; account_email: string | null }, redirectTo?: string) {
  const token = await createJWT({
    user_id: candidate.id,
    email: candidate.account_email,
    role: "candidate",
    type: "candidate",
  });

  await execute("UPDATE candidates SET last_login_at = NOW() WHERE id = $1", [candidate.id]);

  const secure = process.env.NODE_ENV === "production";
  const response = redirectTo
    ? NextResponse.redirect(redirectTo)
    : NextResponse.json({ ok: true, candidateId: candidate.id });

  response.cookies.set(CANDIDATE_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return response;
}

export function clearCandidateAuthCookie(response: NextResponse) {
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(CANDIDATE_TOKEN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(CANDIDATE_MFA_PENDING_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(CANDIDATE_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function getCurrentCandidateContext() {
  const token = cookies().get(CANDIDATE_TOKEN_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifyJWT(token);
  if (!payload || payload.type !== "candidate" || payload.mfa_pending) return null;

  const candidate = await findCandidateById(payload.user_id);
  if (!candidate) return null;

  return { candidateId: candidate.id, candidate };
}

export async function requireCurrentCandidate(options: { allowIncompleteOnboarding?: boolean } = {}) {
  const context = await getCurrentCandidateContext();
  if (!context) {
    return { context: null, response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  }
  if (!options.allowIncompleteOnboarding && !context.candidate.onboarding_complete) {
    return {
      context: null,
      response: NextResponse.json(
        { error: "Complete the required candidate agreement and onboarding before using the portal.", code: "ONBOARDING_REQUIRED" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return { context, response: null };
}

export async function candidatePortalAccessAllowed(candidateId: string): Promise<boolean> {
  const row = await queryOne<{ allowed: boolean }>(
    `SELECT (c.has_contract OR EXISTS (
              SELECT 1 FROM candidate_portal_acceptances a
               WHERE a.candidate_id = c.id
                 AND a.agreement_version = $2
                 AND a.privacy_notice_version = $3
            )) AS allowed
       FROM candidates c WHERE c.id = $1`,
    [candidateId, CANDIDATE_AGREEMENT_VERSION, CANDIDATE_PRIVACY_NOTICE_VERSION],
  );
  return row?.allowed === true;
}
