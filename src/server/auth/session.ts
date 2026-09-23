import { NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, publicUserProfile } from "@/lib/auth";
import type { UserRole } from "@/lib/auth";
import { createJWT } from "@/server/auth/jwt";

interface SessionUser {
  user_id: string;
  email: string | null;
  display_name: string;
  role: UserRole;
  is_active: boolean;
}

export async function createAuthResponse(profile: SessionUser, status = 200) {
  const token = await createJWT({
    user_id: profile.user_id,
    email: profile.email,
    role: profile.role,
  });

  const response = NextResponse.json(
    {
      user: { id: profile.user_id, email: profile.email },
      profile: publicUserProfile(profile),
    },
    { status }
  );

  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(ACCESS_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}

export function clearAuthCookies(response: NextResponse) {
  const secure = process.env.NODE_ENV === "production";
  const expiredCookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 0,
  };

  response.cookies.set(ACCESS_TOKEN_COOKIE, "", expiredCookieOptions);
  response.cookies.set(REFRESH_TOKEN_COOKIE, "", expiredCookieOptions);
  return response;
}
