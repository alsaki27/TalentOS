// src/lib/extensionAuth.ts
// Auth middleware for the A4 Extension API (/api/extension/v1/*).
// Validates Bearer tos_<base64url> tokens against extension_api_keys.
// Returns the error envelope specified in docs/A4_EXTENSION_API.md on failure.

import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/server/db/neon";

export const EXTENSION_SCOPES = {
  jobCapture: "extension:job:capture",
  queueRead: "extension:queue:read",
  readinessRead: "extension:readiness:read",
  evidenceWrite: "extension:evidence:write",
  adaptersRead: "extension:adapters:read",
  resumeRead: "extension:resume:read",
} as const;

export type ExtensionScope = typeof EXTENSION_SCOPES[keyof typeof EXTENSION_SCOPES];

interface ExtensionKeyRow {
  id: string;
  label: string;
  scopes: string[];
  candidate_id: string | null;
}

const CORS_ALLOWED_HEADERS =
  "Authorization, Content-Type, Idempotency-Key, X-TalentOS-Client";

export function getExtensionCorsHeaders(request: NextRequest): Record<string, string> {
  const requestOrigin = request.headers.get("origin");
  const allowedOrigin = requestOrigin && (
    requestOrigin.startsWith("chrome-extension://") ||
    requestOrigin.startsWith("http://localhost:") ||
    requestOrigin.startsWith("http://127.0.0.1:")
  ) ? requestOrigin : "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": CORS_ALLOWED_HEADERS,
  };
  if (allowedOrigin) headers["Access-Control-Allow-Origin"] = allowedOrigin;
  return headers;
}

export function withExtensionCors(
  handler: (request: NextRequest, ...args: any[]) => Promise<NextResponse>
) {
  return async (request: NextRequest, ...args: any[]): Promise<NextResponse> => {
    const corsHeaders = getExtensionCorsHeaders(request);

    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: corsHeaders });
    }

    const response = await handler(request, ...args);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  };
}

function errorResponse(code: string, message: string, status: number, details: Record<string, unknown> = {}) {
  return NextResponse.json(
    { error: { code, message, details } },
    { status }
  );
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function authenticateExtension(
  request: NextRequest,
  requiredScope: ExtensionScope
): Promise<{ key: ExtensionKeyRow } | NextResponse> {
  // Extract token from Authorization: Bearer tos_... or x-api-key header
  let token: string | null = null;
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }
  if (!token) {
    token = request.headers.get("x-api-key");
  }

  if (!token) {
    return errorResponse("invalid_key", "API key missing. Provide Authorization: Bearer tos_... or x-api-key header.", 401);
  }

  // Hash the token and look it up
  const tokenHash = await sha256(token);
  const row = await queryOne<ExtensionKeyRow>(
    `SELECT id, label, scopes, candidate_id
     FROM extension_api_keys
     WHERE key_hash = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );

  if (!row) {
    return errorResponse("invalid_key", "API key is invalid, revoked, or expired.", 401);
  }

  // Check scope
  if (!row.scopes.includes(requiredScope)) {
    return errorResponse("missing_scope", `This key does not have the required scope: ${requiredScope}`, 403);
  }

  return { key: row };
}

export function checkRequiredHeaders(request: NextRequest): NextResponse | null {
  const clientHeader = request.headers.get("x-talentos-client");
  if (!clientHeader) {
    return errorResponse("validation_error", "X-TalentOS-Client header is required.", 400);
  }
  return null;
}

export function checkIdempotencyKey(request: NextRequest): NextResponse | null {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return errorResponse("validation_error", "Idempotency-Key header is required on POST requests.", 400);
  }
  return null;
}

export { errorResponse as extensionError };
