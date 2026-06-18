import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import {
  generatePublicApiKey,
  hashPublicApiKey,
  isValidScope,
  publicApiKeyPrefix,
  PUBLIC_API_SCOPES,
} from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const { data, error } = await supabase
    .from("public_api_keys")
    .select("id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, metadata, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keys: data ?? [], available_scopes: PUBLIC_API_SCOPES });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const scopes = Array.isArray(body.scopes) ? body.scopes.filter((scope: unknown) => typeof scope === "string") : [];
  const invalidScopes = scopes.filter((scope: string) => !isValidScope(scope));
  if (invalidScopes.length > 0) {
    return NextResponse.json({ error: `Invalid scope(s): ${invalidScopes.join(", ")}` }, { status: 400 });
  }

  const key = generatePublicApiKey();
  const { data, error } = await supabase
    .from("public_api_keys")
    .insert({
      name,
      key_prefix: publicApiKeyPrefix(key),
      key_hash: hashPublicApiKey(key),
      scopes,
      expires_at: body.expires_at || null,
      metadata: body.metadata ?? {},
      created_by_user_id: context?.profile.user_id,
      created_by_email: context?.profile.email,
    })
    .select("id, name, key_prefix, scopes, expires_at, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("audit_logs").insert({
    actor_user_id: context?.profile.user_id,
    actor_email: context?.profile.email,
    action: "public_api_key.created",
    entity_type: "public_api_key",
    entity_id: data.id,
    metadata: { name, scopes },
  });

  return NextResponse.json({ ...data, key }, { status: 201 });
}
