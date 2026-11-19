import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import {
  generatePublicApiKey,
  hashPublicApiKey,
  isValidScope,
  publicApiKeyPrefix,
  publicApiScopesForRole,
} from "@/lib/publicApiAuth";
import { query, queryOne } from "@/server/db/neon";
import { recordAuditEvent } from "@/server/repositories/auditLogRepository";

export async function GET() {
  const { context, response } = await requireCurrentUser();
  if (response) return response;
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const isAdmin = context.profile.role === "admin";

  const data = await query(
    `SELECT id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, metadata, created_at, updated_at
       FROM public_api_keys
      WHERE $1::boolean OR created_by_user_id = $2
      ORDER BY created_at DESC`,
    [isAdmin, context.profile.user_id]
  );

  return NextResponse.json({
    keys: data ?? [],
    available_scopes: publicApiScopesForRole(context.profile.role),
    can_manage_all: isAdmin,
  });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const requestedScopes: string[] = Array.isArray(body.scopes)
    ? body.scopes.filter((scope: unknown): scope is string => typeof scope === "string")
    : [];
  const scopes = [...new Set(requestedScopes)];
  const invalidScopes = scopes.filter((scope) => !isValidScope(scope));
  if (invalidScopes.length > 0) {
    return NextResponse.json({ error: `Invalid scope(s): ${invalidScopes.join(", ")}` }, { status: 400 });
  }
  const availableScopes = new Set<string>(publicApiScopesForRole(context.profile.role));
  const restrictedScopes = scopes.filter((scope: string) => !availableScopes.has(scope));
  if (restrictedScopes.length > 0) {
    return NextResponse.json({ error: `Only admins can grant scope(s): ${restrictedScopes.join(", ")}` }, { status: 403 });
  }
  if (scopes.length === 0) return NextResponse.json({ error: "At least one scope is required." }, { status: 400 });

  const key = await generatePublicApiKey();
  const data = await queryOne(
    `INSERT INTO public_api_keys (name, key_prefix, key_hash, scopes, expires_at, metadata, created_by_user_id, created_by_email)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, name, key_prefix, scopes, expires_at, created_at`,
    [
      name,
      publicApiKeyPrefix(key),
      await hashPublicApiKey(key),
      scopes,
      body.expires_at || null,
      body.metadata ?? {},
      context?.profile.user_id,
      context?.profile.email,
    ]
  );

  if (!data) return NextResponse.json({ error: "Insert failed" }, { status: 500 });

  await recordAuditEvent({
    actor_user_id: context?.profile.user_id,
    actor_email: context?.profile.email,
    action: "public_api_key.created",
    entity_type: "public_api_key",
    entity_id: data.id,
    metadata: { name, scopes },
  });

  return NextResponse.json({ ...data, key }, { status: 201 });
}
