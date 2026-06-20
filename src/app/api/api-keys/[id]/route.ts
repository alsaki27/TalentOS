import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { queryOne, execute } from "@/server/db/neon";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await queryOne(
      `UPDATE public_api_keys SET revoked_at = $1, updated_at = $2 WHERE id = $3 RETURNING id, name, scopes`,
      [new Date().toISOString(), new Date().toISOString(), params.id]
    );
    error = data ? null : { message: 'Update failed' };
  } else {
    const res = await supabase
      .from("public_api_keys")
      .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", params.id)
      .select("id, name, scopes")
      .single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (isNeon()) {
    await execute(
      'INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        context?.profile.user_id,
        context?.profile.email,
        'public_api_key.revoked',
        'public_api_key',
        params.id,
        { name: data.name, scopes: data.scopes },
      ]
    );
  } else {
    await supabase.from("audit_logs").insert({
      actor_user_id: context?.profile.user_id,
      actor_email: context?.profile.email,
      action: "public_api_key.revoked",
      entity_type: "public_api_key",
      entity_id: params.id,
      metadata: { name: data.name, scopes: data.scopes },
    });
  }

  return NextResponse.json({ ok: true });
}
