import { NextRequest, NextResponse } from "next/server";
import { exchangeCandidateGoogleCode } from "@/server/auth/candidateGoogle";
import {
  CANDIDATE_OAUTH_STATE_COOKIE,
  findCandidateByGoogleSub,
  findCandidateById,
  createCandidateAuthResponse,
} from "@/server/auth/candidateAuth";
import { queryOne } from "@/server/db/neon";
import { consumeAuthOAuthState } from "@/server/repositories/authOAuthStateRepository";
import { canonicalUrl } from "@/server/runtimeConfig";

function candidateLoginError(code: string) {
  const url = canonicalUrl("/portal/login");
  url.searchParams.set("error", code);
  const response = NextResponse.redirect(url);
  response.cookies.set(CANDIDATE_OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const cookieState = req.cookies.get(CANDIDATE_OAUTH_STATE_COOKIE)?.value;

  if (error) return candidateLoginError("google");
  if (!code || !state || !cookieState || cookieState !== state) return candidateLoginError("state");

  try {
    const savedState = await consumeAuthOAuthState({ state, flow: "candidate_google" });
    if (!savedState) return candidateLoginError("state");

    const googleUser = await exchangeCandidateGoogleCode(code);
    let candidate = await findCandidateByGoogleSub(googleUser.sub);

    if (!candidate && savedState.candidate_id) {
      candidate = await queryOne(
        `UPDATE candidates
            SET google_sub = $1,
                account_email = $2,
                account_created_at = COALESCE(account_created_at, NOW())
          WHERE id = $3
            AND (google_sub IS NULL OR google_sub = $1)
          RETURNING id, name, email, account_email, google_sub, password_hash, account_created_at`,
        [googleUser.sub, googleUser.email, savedState.candidate_id],
      );
    }

    if (!candidate && savedState.candidate_id) candidate = await findCandidateById(savedState.candidate_id);
    if (!candidate || candidate.google_sub !== googleUser.sub) return candidateLoginError("no_account");

    const response = await createCandidateAuthResponse(candidate, canonicalUrl("/portal").toString());
    response.cookies.set(CANDIDATE_OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    console.error("[candidate-google-callback] OAuth callback failed", {
      code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    });
    return candidateLoginError("google");
  }
}
