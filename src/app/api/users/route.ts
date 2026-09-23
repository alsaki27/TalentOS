import { NextRequest, NextResponse } from "next/server";
import { publicUserProfile, requireCurrentUser, type UserRole } from "@/lib/auth";
import { hashPassword } from "@/server/auth/crypto";
import { queryOne } from "@/server/db/neon";
import { listAllProfiles, listActiveProfiles, upsertProfile } from "@/server/repositories/profilesRepository";
import { recordAuditEvent } from "@/server/repositories/auditLogRepository";

const roles: UserRole[] = ["admin", "manager", "application_engineer"];

export async function GET() {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const data = context?.profile.role === "admin"
    ? await listAllProfiles()
    : await listActiveProfiles();

  return NextResponse.json((data ?? []).map((profile) => publicUserProfile(profile as any)));
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const body = await req.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const displayName = String(body.display_name ?? "").trim();
  const role = body.role as UserRole;

  if (!email || !password || !displayName) {
    return NextResponse.json({ error: "Name, email, and temporary password are required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Temporary password must be at least 8 characters." }, { status: 400 });
  }
  if (!roles.includes(role)) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const existingProfile = await queryOne<{ user_id: string }>(
    "SELECT user_id FROM profiles WHERE LOWER(email) = $1",
    [email]
  );
  if (existingProfile) {
    return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  const profile = await upsertProfile({
    user_id: userId,
    email,
    display_name: displayName,
    role,
    is_active: true,
  });

  if (!profile) {
    return NextResponse.json({ error: "Could not create user." }, { status: 500 });
  }

  await queryOne(
    "UPDATE profiles SET password_hash = $1, email_verified = true WHERE user_id = $2",
    [passwordHash, userId]
  );

  await recordAuditEvent({
    actor_user_id: context?.profile.user_id,
    actor_email: context?.profile.email,
    action: "user.created",
    entity_type: "profile",
    entity_id: userId,
    metadata: { email, role },
  });

  return NextResponse.json(publicUserProfile(profile as any), { status: 201 });
}
