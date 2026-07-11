import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { isEncryptionAvailable, encryptSecret, fingerprintKey } from "@/server/security/secretCrypto";
import { query, execute } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";

interface KeyRowForReencrypt {
  id: string;
  provider: string;
  label: string;
  encrypted_key: string;
}

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  if (!isEncryptionAvailable()) {
    return NextResponse.json(
      { error: "AI key encryption is not configured. Set AI_KEYS_ENCRYPTION_SECRET." },
      { status: 503 }
    );
  }

  const keys = await query<KeyRowForReencrypt>(
    `SELECT id, provider, label, encrypted_key FROM ai_api_keys WHERE is_enabled = true`
  );

  let examined = keys.length;
  let reEncrypted = 0;
  let alreadyEncrypted = 0;
  let failed = 0;

  for (const key of keys) {
    if (key.encrypted_key.startsWith("enc:")) {
      alreadyEncrypted++;
      continue;
    }

    // Plaintext key — re-encrypt it using the existing encryption secret.
    try {
      const encrypted = await encryptSecret(key.encrypted_key);
      const fp = await fingerprintKey(key.encrypted_key);
      await execute(
        `UPDATE ai_api_keys SET encrypted_key = $1, key_fingerprint = $2, updated_at = NOW() WHERE id = $3`,
        [encrypted, fp, key.id]
      );
      reEncrypted++;
    } catch (err: any) {
      failed++;
      console.error(`[Re-encrypt] Failed for key ${key.id} (${key.label}):`, err.message);
    }
  }

  if (reEncrypted > 0) {
    await logActivity({
      userId: context?.profile.user_id,
      actorName: context?.profile.display_name || context?.profile.email || "Admin",
      type: "update",
      description: `Re-encrypted ${reEncrypted} plaintext AI keys`,
      entityType: "ai_api_key",
      entityId: "batch",
      entityName: `${reEncrypted} keys secured`,
      metadata: { examined, reEncrypted, alreadyEncrypted, failed },
    });
  }

  return NextResponse.json({ examined, reEncrypted, alreadyEncrypted, failed });
}
