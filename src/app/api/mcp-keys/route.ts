import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { generateMcpKey, hashMcpKey, mcpKeyPrefix, MCP_SCOPES } from "@/lib/mcpAuth";
import { query, queryOne, execute } from "@/server/db/neon";

export async function GET() {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;
  return NextResponse.json({ keys: await query("SELECT id,name,key_prefix,scopes,expires_at,last_used_at,revoked_at,created_at FROM mcp_api_keys ORDER BY created_at DESC"), available_scopes: MCP_SCOPES });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s: unknown) => typeof s === "string") : [];
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const invalid = scopes.filter((s: string) => !(MCP_SCOPES as readonly string[]).includes(s));
  if (invalid.length) return NextResponse.json({ error: `Invalid scope(s): ${invalid.join(", ")}` }, { status: 400 });
  const key = generateMcpKey();
  const row = await queryOne<any>(`INSERT INTO mcp_api_keys(name,key_prefix,key_hash,scopes,expires_at,created_by_user_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,key_prefix,scopes,expires_at,created_at`, [name,mcpKeyPrefix(key),await hashMcpKey(key),scopes,body.expires_at || null,context?.profile.user_id,body.metadata ?? {}]);
  if (!row) return NextResponse.json({ error: "Could not create key" }, { status: 500 });
  return NextResponse.json({ ...row, key, warning: "Copy this key now. It will not be shown again." }, { status: 201 });
}
