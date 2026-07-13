// Extension API key management routes.
// GET  /api/admin/extension-keys         — list all keys (masked)
// POST /api/admin/extension-keys         — issue a new key (returns plaintext once)
// DELETE /api/admin/extension-keys/[id]  — revoke a key (safety-gated)

import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, execute } from "@/server/db/neon";
import { guardedSafetyCheck } from "@/lib/safetyCheck";

const VALID_SCOPES = [
  "extension:job:capture",
  "extension:queue:read",
  "extension:readiness:read",
  "extension:evidence:write",
  "extension:adapters:read",
];

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "tos_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function GET(request: NextRequest) {
  try {
    const rows = await query(
      `SELECT id, label, scopes, candidate_id, created_at, revoked_at
       FROM extension_api_keys
       ORDER BY created_at DESC`
    );
    return NextResponse.json({ keys: rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { label, scopes, candidateId } = body;

    if (!label || typeof label !== "string") {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }

    // Validate scopes
    const requestedScopes: string[] = Array.isArray(scopes) ? scopes : [];
    const invalid = requestedScopes.filter((s) => !VALID_SCOPES.includes(s));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Invalid scopes: ${invalid.join(", ")}. Valid: ${VALID_SCOPES.join(", ")}` },
        { status: 400 }
      );
    }

    // Generate the key and hash it for storage
    const plaintextKey = generateKey();
    const keyHash = await sha256(plaintextKey);

    const row = await queryOne<{ id: string }>(
      `INSERT INTO extension_api_keys (label, key_hash, scopes, candidate_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [label, keyHash, requestedScopes, candidateId ?? null]
    );

    // Audit
    await guardedSafetyCheck({
      operation: "create",
      resource: "extension_api_keys",
      detail: `Issued key "${label}" with scopes [${requestedScopes.join(", ")}]`,
    });

    // Return plaintext ONCE — never stored, never retrievable again
    return NextResponse.json({
      id: row!.id,
      label,
      key: plaintextKey,
      scopes: requestedScopes,
      message: "Save this key — it cannot be retrieved again.",
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}