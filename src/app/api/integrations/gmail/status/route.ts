import { NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, getCurrentUserContext, hasRole } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";

export async function GET() {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const filters = [
    `owner_user_id.eq.${context.profile.user_id}`,
  ];
  if (hasRole(context.profile, DESTRUCTIVE_MANAGER_ROLES)) {
    filters.push("owner_type.eq.shared_application_mailbox");
  }

  let data: any;
  let error: any;

  if (isNeon()) {
    try {
      const isManager = hasRole(context.profile, DESTRUCTIVE_MANAGER_ROLES);
      const sql = isManager
        ? `SELECT id, provider, owner_type, email, scopes, status, token_expires_at, last_synced_at, created_at, updated_at
           FROM integration_accounts
           WHERE provider = 'gmail' AND (owner_user_id = $1 OR owner_type = 'shared_application_mailbox')
           ORDER BY updated_at DESC`
        : `SELECT id, provider, owner_type, email, scopes, status, token_expires_at, last_synced_at, created_at, updated_at
           FROM integration_accounts
           WHERE provider = 'gmail' AND owner_user_id = $1
           ORDER BY updated_at DESC`;
      data = await query(sql, [context.profile.user_id]);
      error = null;
    } catch (err: any) {
      error = { message: err.message };
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("integration_accounts")
      .select("id, provider, owner_type, email, scopes, status, token_expires_at, last_synced_at, created_at, updated_at")
      .eq("provider", "gmail")
      .or(filters.join(","))
      .order("updated_at", { ascending: false });
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
