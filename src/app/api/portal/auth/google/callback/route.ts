import { NextRequest, NextResponse } from "next/server";
import { exchangeCandidateGoogleCode } from "@/server/auth/candidateGoogle";
import {
  CANDIDATE_OAUTH_STATE_COOKIE,
  findCandidateByGoogleSub,
  findCandidateByPortalToken,
  createCandidateAuthResponse,
} from "@/server/auth/candidateAuth";
import { execute } from "@/server/db/neon";

// Never derive redirects from the incoming request's origin — confirmed
// unreliable inside this Worker runtime (a sibling route's req.url resolved to
// "http://n" in production). Same TALENTOS_BASE_URL convention used everywhere
// else in this codebase.
const BASE_URL = process.env.TALENTOS_BASE_URL || "https://skarion-talent-os.skarion-talentos.workers.dev";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const stateCookieRaw = req.cookies.get(CANDIDATE_OAUTH_STATE_COOKIE)?.value;
  let savedState: { state: string; invite: string } | null = null;
  try {
    savedState = stateCookieRaw ? JSON.parse(stateCookieRaw) : null;
  } catch {
    savedState = null;
  }

  if (error) return NextResponse.redirect(new URL("/portal/login?error=google", BASE_URL));
  if (!code || !state || !savedState || savedState.state !== state) {
    return NextResponse.redirect(new URL("/portal/login?error=state", BASE_URL));
  }

  try {
    const googleUser = await exchangeCandidateGoogleCode(code);

    // Case 1: this Google account is already linked to a candidate -> log in.
    let candidate = await findCandidateByGoogleSub(googleUser.sub);

    // Case 2: fresh Google sign-in arriving via an invite link -> link it to that
    // specific candidate record (never guess by email match alone; the invite
    // token is the proof of identity here).
    if (!candidate && savedState.invite) {
      const invited = await findCandidateByPortalToken(savedState.invite);
      if (
        invited &&
        !invited.portal_token_revoked_at &&
        (!invited.portal_token_expires_at || new Date(invited.portal_token_expires_at).getTime() > Date.now())
      ) {
        await execute(
          "UPDATE candidates SET google_sub = $1, account_email = $2, account_created_at = COALESCE(account_created_at, NOW()) WHERE id = $3",
          [googleUser.sub, googleUser.email, invited.id]
        );
        candidate = { ...invited, google_sub: googleUser.sub, account_email: googleUser.email };
      }
    }

    if (!candidate) {
      return NextResponse.redirect(new URL("/portal/login?error=no_account", BASE_URL));
    }

    const response = await createCandidateAuthResponse(candidate, new URL("/portal", BASE_URL).toString());
    response.cookies.set(CANDIDATE_OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  } catch (err: any) {
    return NextResponse.redirect(new URL(`/portal/login?error=${encodeURIComponent(err.message || "google")}`, BASE_URL));
  }
}
