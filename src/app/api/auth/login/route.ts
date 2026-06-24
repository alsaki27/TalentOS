import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, publicUserProfile } from "@/lib/auth";
import { verifyPassword } from "@/server/auth/crypto";
import { createJWT } from "@/server/auth/jwt";
import { queryOne } from "@/server/db/neon";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const profile = await queryOne<{
    user_id: string;
    email: string;
    display_name: string;
    role: string;
    is_active: boolean;
    password_hash: string | null;
  }>(
    "SELECT user_id, email, display_name, role, is_active, password_hash FROM profiles WHERE email = $1",
    [email]
  );

  if (!profile) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  if (!profile.is_active) {
    return NextResponse.json({ error: "This user is inactive." }, { status: 403 });
  }

  if (!profile.password_hash) {
    return NextResponse.json(
      { error: "Account requires password reset. Contact your administrator." },
      { status: 403 }
    );
  }

  const valid = await verifyPassword(password, profile.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const token = await createJWT({
    user_id: profile.user_id,
    email: profile.email,
    role: profile.role,
  });

  const secure = process.env.NODE_ENV === "production";
  cookies().set(ACCESS_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  cookies().set(REFRESH_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return NextResponse.json({
    user: { id: profile.user_id, email: profile.email },
    profile: publicUserProfile(profile as any),
  });
}
