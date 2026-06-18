import { NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, getCurrentUserContext, hasRole } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const filters = [
    `owner_user_id.eq.${context.profile.user_id}`,
  ];
  if (hasRole(context.profile, DESTRUCTIVE_MANAGER_ROLES)) {
    filters.push("owner_type.eq.shared_application_mailbox");
  }

  const { data, error } = await supabase
    .from("integration_accounts")
    .select("id, provider, owner_type, email, scopes, status, token_expires_at, last_synced_at, created_at, updated_at")
    .eq("provider", "gmail")
    .or(filters.join(","))
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
