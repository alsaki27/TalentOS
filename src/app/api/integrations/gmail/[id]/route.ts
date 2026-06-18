import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, getCurrentUserContext, hasRole } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { data: account, error: accountError } = await supabase
    .from("integration_accounts")
    .select("id, owner_type, owner_user_id, email")
    .eq("id", params.id)
    .eq("provider", "gmail")
    .single();

  if (accountError || !account) return NextResponse.json({ error: "Gmail account not found." }, { status: 404 });

  const canDelete = account.owner_user_id === context.profile.user_id
    || (account.owner_type === "shared_application_mailbox" && hasRole(context.profile, DESTRUCTIVE_MANAGER_ROLES));

  if (!canDelete) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const { error } = await supabase
    .from("integration_accounts")
    .update({ status: "revoked", access_token: null, refresh_token: null, updated_at: new Date().toISOString() })
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("audit_logs").insert({
    actor_user_id: context.profile.user_id,
    actor_email: context.profile.email,
    action: "integration.gmail.revoked",
    entity_type: "integration_account",
    entity_id: params.id,
    metadata: { email: account.email, owner_type: account.owner_type },
  });

  return NextResponse.json({ ok: true });
}
