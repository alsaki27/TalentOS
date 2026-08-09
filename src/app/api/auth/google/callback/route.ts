import { NextRequest, NextResponse } from "next/server";
import {
  GOOGLE_OAUTH_STATE_COOKIE,
  POST_AUTH_REDIRECT_COOKIE,
  getDefaultRouteForRole,
  sanitizeInternalPath,
} from "@/lib/auth";
import { exchangeGoogleCodeForUser } from "@/server/auth/google";
import { countProfiles, createAuditLog, createProfile, findProfileByEmail } from "@/server/auth/profiles";
import { createAuthResponse } from "@/server/auth/session";
import { consumeAuthOAuthState } from "@/server/repositories/authOAuthStateRepository";
import { canonicalUrl } from "@/server/runtimeConfig";

function clearOAuthCookies(response: NextResponse) {
  response.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE);
  response.cookies.delete(POST_AUTH_REDIRECT_COOKIE);
  return response;
}

function loginError(message: string) {
  const redirectUrl = canonicalUrl("/login");
  redirectUrl.searchParams.set("error", message);
  return clearOAuthCookies(NextResponse.redirect(redirectUrl));
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const cookieState = req.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;

  if (error) return loginError("Google sign-in was cancelled.");
  if (!code || !state || !cookieState || state !== cookieState) {
    return loginError("Google sign-in could not be verified.");
  }

  try {
    const savedState = await consumeAuthOAuthState({ state, flow: "staff_google" });
    if (!savedState) return loginError("Google sign-in expired or was already used.");

    const googleUser = await exchangeGoogleCodeForUser(code);
    let profile = await findProfileByEmail(googleUser.email);

    if (!profile) {
      const profileCount = await countProfiles();
      if (profileCount > 0) {
        return loginError("This Google account is not authorized for TalentOS. Ask an administrator to add it first.");
      }
      const role = "admin";
      profile = await createProfile({
        email: googleUser.email,
        displayName: googleUser.name || googleUser.email.split("@")[0],
        role,
        passwordHash: null,
        emailVerified: googleUser.email_verified ?? true,
      });
      await createAuditLog({
        actorUserId: profile.user_id,
        actorEmail: profile.email,
        action: "auth.google_signup",
        entityType: "profile",
        entityId: profile.user_id,
        metadata: { role, google_sub: googleUser.sub },
      });
    } else {
      await createAuditLog({
        actorUserId: profile.user_id,
        actorEmail: profile.email,
        action: "auth.google_login",
        entityType: "profile",
        entityId: profile.user_id,
        metadata: { google_sub: googleUser.sub },
      });
    }

    if (!profile.is_active) return loginError("This user is inactive.");

    const sessionResponse = await createAuthResponse(profile);
    const nextPath = sanitizeInternalPath(savedState.next_path) || getDefaultRouteForRole(profile.role);
    const response = NextResponse.redirect(canonicalUrl(nextPath));
    for (const cookie of sessionResponse.cookies.getAll()) response.cookies.set(cookie);
    return clearOAuthCookies(response);
  } catch (error) {
    console.error("[staff-google-callback] OAuth callback failed", {
      code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    });
    return loginError("Google sign-in failed. Please try again.");
  }
}
