// src/server/auth/candidateGoogle.ts
import { candidateGoogleRedirectUri as configuredCandidateGoogleRedirectUri } from "@/server/runtimeConfig";
// Candidate "Continue with Google" login — basic identity scope only
// (openid email profile). Deliberately separate from src/lib/integrations/googleGmail.ts,
// which requests gmail.readonly for the Phase 2 email-reading feature. Login and
// "let TalentOS read my Gmail" must stay two distinct, separately-revocable grants.

export const CANDIDATE_LOGIN_SCOPES = ["openid", "email", "profile"];

// Never derive this from the incoming request's origin — confirmed unreliable
// inside this Worker runtime (a sibling route's req.url resolved to "http://n"
// in production). Same TALENTOS_BASE_URL convention used everywhere else in
// this codebase. The redirect_uri sent here MUST exactly match what's
// registered in Google Cloud Console and what's sent again during the token
// exchange — a request-derived value can't guarantee that consistency.
function candidateGoogleRedirectUri() {
  return configuredCandidateGoogleRedirectUri();
}

export function candidateGoogleAuthUrl(state: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not configured.");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", candidateGoogleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CANDIDATE_LOGIN_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function exchangeCandidateGoogleCode(code: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not configured.");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: candidateGoogleRedirectUri(),
    }),
    cache: "no-store",
  });

  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || "Google token exchange failed.");
  }

  const userInfoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${String(tokenData.access_token)}` },
    cache: "no-store",
  });
  const userInfo = await userInfoRes.json().catch(() => ({}));
  if (!userInfoRes.ok || !userInfo.email || !userInfo.sub || userInfo.email_verified !== true) {
    throw new Error("Could not load the Google account profile.");
  }

  return {
    sub: String(userInfo.sub),
    email: String(userInfo.email).toLowerCase(),
    name: userInfo.name || userInfo.given_name || String(userInfo.email).split("@")[0],
    email_verified: true,
  };
}
