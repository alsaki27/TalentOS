import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/server/auth/crypto";
import { findProfileByEmail } from "@/server/auth/profiles";
import { createAuthResponse } from "@/server/auth/session";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const profile = await findProfileByEmail(email);

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

  return createAuthResponse(profile);
}
