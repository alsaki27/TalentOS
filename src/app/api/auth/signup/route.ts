import { NextRequest, NextResponse } from "next/server";
import type { UserRole } from "@/lib/auth";
import { hashPassword } from "@/server/auth/crypto";
import { countProfiles, createAuditLog, createProfile, findProfileByEmail } from "@/server/auth/profiles";
import { createAuthResponse } from "@/server/auth/session";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const displayName = String(body.display_name ?? "").trim();

  if (!displayName || !email || !password) {
    return NextResponse.json({ error: "Name, email, and password are required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const existingProfile = await findProfileByEmail(email);
  if (existingProfile) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const profileCount = await countProfiles();
  const role: UserRole = profileCount === 0 ? "admin" : "application_engineer";
  const passwordHash = await hashPassword(password);
  const profile = await createProfile({
    email,
    displayName,
    role,
    passwordHash,
    emailVerified: true,
  });

  await createAuditLog({
    actorUserId: profile.user_id,
    actorEmail: profile.email,
    action: "auth.signup",
    entityType: "profile",
    entityId: profile.user_id,
    metadata: { role },
  });

  return createAuthResponse(profile, 201);
}
