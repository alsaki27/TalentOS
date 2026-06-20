import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/server/auth/crypto";
import { isNeon } from "@/server/db";
import { execute, queryOne } from "@/server/db/neon";

export async function PATCH(req: NextRequest) {
  const context = await getCurrentUserContext();
  if (!context) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await req.json();
  const currentPassword = String(body.current_password ?? "");
  const newPassword = String(body.password ?? "");

  if (!currentPassword) {
    return NextResponse.json({ error: "Current password is required." }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }

  // Verify current password
  const profile = await queryOne<{ password_hash: string | null }>(
    "SELECT password_hash FROM profiles WHERE user_id = $1",
    [context.user.id]
  );

  if (!profile?.password_hash) {
    return NextResponse.json({ error: "Account has no password set." }, { status: 400 });
  }

  const valid = await verifyPassword(currentPassword, profile.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
  }

  // Hash and update new password
  const newHash = await hashPassword(newPassword);

  if (isNeon()) {
    await execute(
      "UPDATE profiles SET password_hash = $1, updated_at = NOW() WHERE user_id = $2",
      [newHash, context.user.id]
    );
    await execute(
      `INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [context.profile.user_id, context.profile.email, "auth.password_changed", "profile", context.profile.user_id]
    );
  } else {
    // Fallback for Supabase (should not be reached with DB_PROVIDER=neon)
    const { supabase } = await import("@/lib/supabase");
    await supabase.from("profiles").update({ password_hash: newHash }).eq("user_id", context.user.id);
    await supabase.from("audit_logs").insert({
      actor_user_id: context.profile.user_id,
      actor_email: context.profile.email,
      action: "auth.password_changed",
      entity_type: "profile",
      entity_id: context.profile.user_id,
    });
  }

  return NextResponse.json({ ok: true });
}
