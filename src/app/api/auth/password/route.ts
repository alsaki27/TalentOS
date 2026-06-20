import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { execute } from "@/server/db/neon";

export async function PATCH(req: NextRequest) {
  const context = await getCurrentUserContext();
  if (!context) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await req.json();
  const password = String(body.password ?? "");
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const { error } = await supabase.auth.admin.updateUserById(context.user.id, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (isNeon()) {
    await execute(
      `INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      [context.profile.user_id, context.profile.email, "auth.password_changed", "profile", context.profile.user_id]
    );
  } else {
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
