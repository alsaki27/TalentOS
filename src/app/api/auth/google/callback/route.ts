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

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const cookieState = req.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  const nextPath = sanitizeInternalPath(req.cookies.get(POST_AUTH_REDIRECT_COOKIE)?.value);

  if (error) {
    const redirectUrl = new URL("/login", req.nextUrl.origin);
    redirectUrl.searchParams.set("error", "Google sign-in was cancelled.");
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE);
    response.cookies.delete(POST_AUTH_REDIRECT_COOKIE);
    return response;
  }

  if (!code || !state || !cookieState || state !== cookieState) {
    const redirectUrl = new URL("/login", req.nextUrl.origin);
    redirectUrl.searchParams.set("error", "Google sign-in could not be verified.");
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE);
    response.cookies.delete(POST_AUTH_REDIRECT_COOKIE);
    return response;
  }

  try {
    const googleUser = await exchangeGoogleCodeForUser(req.nextUrl.origin, code);
    let profile = await findProfileByEmail(googleUser.email);

    if (!profile) {
      const role = (await countProfiles()) === 0 ? "admin" : "application_engineer";
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

    if (!profile.is_active) {
      const redirectUrl = new URL("/login", req.nextUrl.origin);
      redirectUrl.searchParams.set("error", "This user is inactive.");
      const response = NextResponse.redirect(redirectUrl);
      response.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE);
      response.cookies.delete(POST_AUTH_REDIRECT_COOKIE);
      return response;
    }

    const jsonResponse = await createAuthResponse(profile);
    const redirectUrl = new URL(nextPath || getDefaultRouteForRole(profile.role), req.nextUrl.origin);
    const response = NextResponse.redirect(redirectUrl);

    for (const cookie of jsonResponse.cookies.getAll()) {
      response.cookies.set(cookie);
    }
    response.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE);
    response.cookies.delete(POST_AUTH_REDIRECT_COOKIE);

    return response;
  } catch (err: any) {
    const redirectUrl = new URL("/login", req.nextUrl.origin);
    redirectUrl.searchParams.set("error", err?.message || "Google sign-in failed.");
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE);
    response.cookies.delete(POST_AUTH_REDIRECT_COOKIE);
    return response;
  }
}
