import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, getCurrentUserContext, hasRole } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { queryOne, execute } from "@/server/db/neon";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const context = await getCurrentUserContext();
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  if (isNeon()) {
    const account = await queryOne<{ id: string; owner_type: string; owner_user_id: string | null; email: string }>(
      "SELECT id, owner_type, owner_user_id, email FROM integration_accounts WHERE id = $1 AND provider = $2",
      [params.id, "gmail"]
    );
    if (!account) return NextResponse.json({ error: "Gmail account not found." }, { status: 404 });

    const canDelete = account.owner_user_id === context.profile.user_id
      || (account.owner_type === "shared_application_mailbox" && hasRole(context.profile, DESTRUCTIVE_MANAGER_ROLES));

    if (!canDelete) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

    await execute(
      "UPDATE integration_accounts SET status = $1, access_token = $2, refresh_token = $3, updated_at = $4 WHERE id = $5",
      ["revoked", null, null, new Date().toISOString(), params.id]
    );

    await execute(
      "INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)",
      [context.profile.user_id, context.profile.email, "integration.gmail.revoked", "integration_account", params.id, { email: account.email, owner_type: account.owner_type }]
    );

    return NextResponse.json({ ok: true });
  }

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
