// src/lib/apiKeyAuth.ts
// API key validation for external integration endpoints (crawler, webhooks, etc.).
// Checks against the public_api_keys table first (scopes: jobs:import or crawler),
// then falls back to the legacy CRAWLER_API_KEY env variable.

import { NextRequest, NextResponse } from "next/server";
import { hashPublicApiKey } from "./publicApiAuth";
import { supabase } from "./supabase";

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
  const { data, error } = await supabase
    .from("public_api_keys")
    .select("id, scopes, revoked_at, expires_at")
    .eq("key_hash", hashPublicApiKey(key))
    .maybeSingle();

  if (!error && data) {
    if (!data.revoked_at && (!data.expires_at || new Date(data.expires_at).getTime() > Date.now())) {
      const scopes = Array.isArray(data.scopes) ? data.scopes : [];
      if (scopes.includes("jobs:import") || scopes.includes("crawler")) {
        // Touch last_used_at
        await supabase
          .from("public_api_keys")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", data.id)
          .then(() => {}); // fire-and-forget
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
