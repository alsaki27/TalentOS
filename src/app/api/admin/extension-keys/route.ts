// Extension API key management routes.
// GET  /api/admin/extension-keys         — list all keys (masked)
// POST /api/admin/extension-keys         — issue a new key (returns plaintext once)
// DELETE /api/admin/extension-keys/[id]  — revoke a key (safety-gated)

import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, execute } from "@/server/db/neon";
import { guardedSafetyCheck } from "@/lib/safetyCheck";
import { requireCurrentUser } from "@/lib/auth";

const VALID_SCOPES = [
  "extension:job:capture",
  "extension:queue:read",
  "extension:readiness:read",
  "extension:evidence:write",
  "extension:adapters:read",
  "extension:resume:read",
  "extension:application:assign",
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
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;
  try {
    const rows = await query(
      `SELECT k.id, k.label, k.scopes, k.candidate_id, k.owner_user_id,
              p.display_name AS owner_name, p.email AS owner_email, p.role AS owner_role,
              k.created_at, k.last_used_at, k.revoked_at
         FROM extension_api_keys k
         LEFT JOIN profiles p ON p.user_id = k.owner_user_id
        ORDER BY k.created_at DESC`
    );
    return NextResponse.json({ keys: rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;
  try {
    const body = await request.json();
    const { label, scopes, candidateId, ownerUserId } = body;

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

    const needsTeamMemberOwner = requestedScopes.some((scope) =>
      scope === "extension:job:capture" || scope === "extension:application:assign"
    );
    if (needsTeamMemberOwner && (typeof ownerUserId !== "string" || !ownerUserId.trim())) {
      return NextResponse.json({ error: "An active team member must own job-capture and candidate-logging keys." }, { status: 400 });
    }
    if (ownerUserId) {
      const owner = await queryOne<{ user_id: string }>(
        `SELECT user_id FROM profiles
          WHERE user_id = $1 AND is_active = true`,
        [ownerUserId],
      );
      if (!owner) return NextResponse.json({ error: "Key owner must be an active team member." }, { status: 400 });
    }

    // Generate the key and hash it for storage
    const plaintextKey = generateKey();
    const keyHash = await sha256(plaintextKey);

    const row = await queryOne<{ id: string }>(
      `INSERT INTO extension_api_keys (label, key_hash, scopes, candidate_id, owner_user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [label, keyHash, requestedScopes, candidateId ?? null, ownerUserId ?? null]
    );

    // Audit
    await guardedSafetyCheck({
      operation: "create",
      resource: "extension_api_keys",
      detail: `Issued key "${label}"${ownerUserId ? ` for team member ${ownerUserId}` : ""} with scopes [${requestedScopes.join(", ")}]`,
    });

    // Return plaintext ONCE — never stored, never retrievable again
    return NextResponse.json({
      id: row!.id,
      label,
      ownerUserId: ownerUserId ?? null,
      key: plaintextKey,
      scopes: requestedScopes,
      message: "Save this key — it cannot be retrieved again.",
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
