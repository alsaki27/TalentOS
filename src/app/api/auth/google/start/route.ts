import { NextRequest, NextResponse } from "next/server";
import { GOOGLE_OAUTH_STATE_COOKIE, sanitizeInternalPath } from "@/lib/auth";
import { getGoogleAuthUrl } from "@/server/auth/google";
import { createAuthOAuthState, newAuthOAuthState } from "@/server/repositories/authOAuthStateRepository";
import { envFlag, googleConfigurationReadiness } from "@/server/runtimeConfig";

export async function GET(req: NextRequest) {
  const readiness = googleConfigurationReadiness();
  if (!envFlag("STAFF_GOOGLE_AUTH_ENABLED", true) || !readiness.ready) {
    return NextResponse.json({ error: "GOOGLE_AUTH_NOT_READY", readiness }, { status: 503 });
  }

  const state = newAuthOAuthState();
  const nextPath = sanitizeInternalPath(req.nextUrl.searchParams.get("next")) || "/jobs";
  await createAuthOAuthState({ state, flow: "staff_google", nextPath });
  const authUrl = getGoogleAuthUrl(state, nextPath);

  const response = NextResponse.redirect(authUrl);
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
