import { NextRequest, NextResponse } from "next/server";
import { candidateGoogleAuthUrl } from "@/server/auth/candidateGoogle";
import { CANDIDATE_OAUTH_STATE_COOKIE, findCandidateByPortalToken } from "@/server/auth/candidateAuth";
import { createAuthOAuthState, newAuthOAuthState } from "@/server/repositories/authOAuthStateRepository";
import { envFlag, googleConfigurationReadiness } from "@/server/runtimeConfig";

// ?invite=<portal_token> is carried through the OAuth round trip via a short-lived
// signed-nothing state cookie (this is a login flow, not the Gmail-read grant, so it
// deliberately does NOT touch integration_oauth_states — that table is reserved for
// provider='gmail' data-access grants).
export async function GET(req: NextRequest) {
  const readiness = googleConfigurationReadiness();
  if (!envFlag("CANDIDATE_GOOGLE_AUTH_ENABLED") || !readiness.ready) {
    return NextResponse.json({ error: "CANDIDATE_GOOGLE_AUTH_NOT_READY", readiness }, { status: 503 });
  }

  const url = new URL(req.url);
  const invite = url.searchParams.get("invite") || "";
  let candidateId: string | null = null;
  if (invite) {
    const candidate = await findCandidateByPortalToken(invite);
    if (
      candidate &&
      !candidate.portal_token_revoked_at &&
      (!candidate.portal_token_expires_at || new Date(candidate.portal_token_expires_at).getTime() > Date.now())
    ) {
      candidateId = candidate.id;
    }
    if (!candidateId) {
      return NextResponse.json({ error: "Candidate invite is invalid or expired." }, { status: 410 });
    }
  }

  const state = newAuthOAuthState();
  await createAuthOAuthState({ state, flow: "candidate_google", candidateId });

  const response = NextResponse.redirect(candidateGoogleAuthUrl(state));
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(CANDIDATE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
