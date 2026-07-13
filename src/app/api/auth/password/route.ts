import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/server/auth/crypto";
import { queryOne } from "@/server/db/neon";
import { updatePasswordHash } from "@/server/repositories/profilesRepository";
import { recordAuditEvent } from "@/server/repositories/auditLogRepository";

export async function PATCH(req: NextRequest) {
  const context = await getCurrentUserContext();
  if (!context) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await req.json();
  const currentPassword = String(body.current_password ?? "");
  const newPassword = String(body.password ?? "");

  if (newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }

  const profile = await queryOne<{ password_hash: string | null }>(
    "SELECT password_hash FROM profiles WHERE user_id = $1",
    [context.user.id]
  );

  if (profile?.password_hash) {
    if (!currentPassword) {
      return NextResponse.json({ error: "Current password is required." }, { status: 400 });
    }

    const valid = await verifyPassword(currentPassword, profile.password_hash);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }
  }

  const newHash = await hashPassword(newPassword);

  await updatePasswordHash(context.user.id, newHash);

  await recordAuditEvent({
    actor_user_id: context.profile.user_id,
    actor_email: context.profile.email,
    action: "auth.password_changed",
    entity_type: "profile",
    entity_id: context.profile.user_id,
  });

  return NextResponse.json({ ok: true });
}
