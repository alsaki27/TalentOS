// src/lib/apiKeyAuth.ts
// API key validation for external integration endpoints (crawler, webhooks, etc.).
// Checks against the public_api_keys table first (scopes: jobs:import or crawler),
// then falls back to the legacy CRAWLER_API_KEY env variable.

import { NextRequest, NextResponse } from "next/server";
import { hashPublicApiKey } from "./publicApiAuth";
import { queryOne, execute } from "@/server/db/neon";

export interface ApiKeyValidationResult {
  valid: boolean;
  keyId?: string;
  error?: Response;
}

export async function validateApiKey(req: NextRequest): Promise<ApiKeyValidationResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      valid: false,
      error: NextResponse.json({ error: "Missing Authorization header" }, { status: 401 }),
    };
  }

  const key = authHeader.replace("Bearer ", "");

  // 1. Check against public_api_keys table (jobs:import or crawler scope)
  const data = await queryOne<{ id: string; scopes: string[]; revoked_at: string | null; expires_at: string | null }>(
    "SELECT id, scopes, revoked_at, expires_at FROM public_api_keys WHERE key_hash = $1",
    [await hashPublicApiKey(key)]
  );

  if (data) {
    if (!data.revoked_at && (!data.expires_at || new Date(data.expires_at).getTime() > Date.now())) {
      const scopes = Array.isArray(data.scopes) ? data.scopes : [];
      if (scopes.includes("jobs:import") || scopes.includes("crawler")) {
        // Touch last_used_at
        await execute(
          "UPDATE public_api_keys SET last_used_at = $1 WHERE id = $2",
          [new Date().toISOString(), data.id]
        );
        return { valid: true, keyId: data.id };
      }
    }
  }

  // 2. Fallback: legacy env var CRAWLER_API_KEY
  const crawlerKey = process.env.CRAWLER_API_KEY;
  if (crawlerKey && key === crawlerKey) {
    return { valid: true };
  }

  return {
    valid: false,
    error: NextResponse.json({ error: "Invalid API key" }, { status: 401 }),
  };
}

export function isIntegrationApiKeyValid(authHeader: string | null): boolean {
  const key = process.env.CRAWLER_API_KEY;
  if (!key || !authHeader) return false;
  return authHeader === `Bearer ${key}`;
}
