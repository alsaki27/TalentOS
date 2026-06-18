import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const { data, error } = await supabase
    .from("public_api_keys")
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select("id, name, scopes")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("audit_logs").insert({
    actor_user_id: context?.profile.user_id,
    actor_email: context?.profile.email,
    action: "public_api_key.revoked",
    entity_type: "public_api_key",
    entity_id: params.id,
    metadata: { name: data.name, scopes: data.scopes },
  });

  return NextResponse.json({ ok: true });
}
