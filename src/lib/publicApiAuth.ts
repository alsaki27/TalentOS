import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const PUBLIC_API_SCOPES = [
  "candidates:read",
  "candidates:write",
  "candidates:delete",
  "jobs:read",
  "jobs:write",
  "jobs:delete",
  "jobs:import",
  "jobs:shortlist",
  "applications:read",
  "applications:write",
  "applications:delete",
  "applications:assign",
  "applications:status",
  "applications:comment",
  "companies:read",
  "companies:write",
  "companies:delete",
  "company_people:read",
  "company_people:write",
  "company_people:delete",
  "events:read",
  "events:write",
  "events:acknowledge",
  "reminders:read",
  "reminders:write",
  "analytics:read",
  "integrations:gmail:read",
  "integrations:gmail:write",
  "integrations:teams:write",
  "api_keys:manage",
] as const;

export type PublicApiScope = typeof PUBLIC_API_SCOPES[number];

export interface PublicApiContext {
  id: string;
  name: string;
  scopes: string[];
  key_prefix: string;
}

export async function generatePublicApiKey(): Promise<string> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const secret = btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `sk_live_${secret}`;
}

export async function hashPublicApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(key));
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex;
}

export function publicApiKeyPrefix(key: string) {
  return key.slice(0, 16);
}

export function isValidScope(scope: string): scope is PublicApiScope {
  return (PUBLIC_API_SCOPES as readonly string[]).includes(scope);
}

function keyFromRequest(req: NextRequest) {
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return req.headers.get("x-api-key")?.trim() ?? "";
}

export async function requirePublicApiScope(req: NextRequest, required: PublicApiScope | PublicApiScope[]) {
  const requiredScopes = Array.isArray(required) ? required : [required];
  const key = keyFromRequest(req);
  if (!key) {
    return {
      context: null,
      response: NextResponse.json({ error: "API key required. Use Authorization: Bearer <key>." }, { status: 401 }),
    };
  }

  const { data, error } = await supabase
    .from("public_api_keys")
    .select("id, name, key_prefix, scopes, expires_at, revoked_at")
    .eq("key_hash", await hashPublicApiKey(key))
    .maybeSingle();

  if (error) {
    return { context: null, response: NextResponse.json({ error: error.message }, { status: 500 }) };
  }
  if (!data || data.revoked_at || (data.expires_at && new Date(data.expires_at).getTime() < Date.now())) {
    return { context: null, response: NextResponse.json({ error: "Invalid or expired API key." }, { status: 401 }) };
  }

  const scopes = Array.isArray(data.scopes) ? data.scopes : [];
  const hasScope = requiredScopes.every((scope) => scopes.includes(scope));
  if (!hasScope) {
    return {
      context: null,
      response: NextResponse.json({ error: `Missing required scope: ${requiredScopes.join(", ")}` }, { status: 403 }),
    };
  }

  await supabase
    .from("public_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return {
    context: data as PublicApiContext,
    response: null,
  };
}

export function pageParams(req: NextRequest, defaults = { page: 1, pageSize: 50, maxPageSize: 200 }) {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || String(defaults.page), 10) || defaults.page);
  const pageSize = Math.min(
    defaults.maxPageSize,
    Math.max(1, parseInt(url.searchParams.get("pageSize") || String(defaults.pageSize), 10) || defaults.pageSize),
  );
  return { url, page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 };
}

export function pickFields(body: Record<string, unknown>, fields: string[]) {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in body) picked[field] = body[field];
  }
  return picked;
}
