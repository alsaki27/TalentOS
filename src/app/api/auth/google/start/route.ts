import { NextRequest, NextResponse } from "next/server";
import { GOOGLE_OAUTH_STATE_COOKIE, POST_AUTH_REDIRECT_COOKIE, sanitizeInternalPath } from "@/lib/auth";
import { getGoogleAuthUrl } from "@/server/auth/google";

export async function GET(req: NextRequest) {
  const state = crypto.randomUUID();
  const nextPath = sanitizeInternalPath(req.nextUrl.searchParams.get("next")) || "/jobs";
  const authUrl = getGoogleAuthUrl(req.nextUrl.origin, state, nextPath);

  const response = NextResponse.redirect(authUrl);
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 10,
  });
  response.cookies.set(POST_AUTH_REDIRECT_COOKIE, nextPath, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 10,
  });

  return response;
}
