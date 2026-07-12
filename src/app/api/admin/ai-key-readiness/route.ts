import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { isEncryptionAvailable } from "@/server/security/secretCrypto";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Accept CRON_SECRET Bearer token for automated CI checks (no login required)
  const authHeader = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  const isCronAuth = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCronAuth) {
    const { response } = await requireCurrentUser(["admin"]);
    if (response) return response;
  }

  const encryptionConfigured = isEncryptionAvailable();

  let totalKeys = 0;
  let encryptedKeys = 0;
  let plaintextKeys = 0;
  let disabledKeys = 0;

  if (encryptionConfigured) {
    try {
      const keys = await query<{ encrypted_key: string; is_enabled: boolean }>(
        `SELECT encrypted_key, is_enabled FROM ai_api_keys`
      );
      totalKeys = keys.length;
      for (const key of keys) {
        if (!key.is_enabled) disabledKeys++;
        if (key.encrypted_key.startsWith("enc:")) {
          encryptedKeys++;
        } else {
          plaintextKeys++;
        }
      }
    } catch (err: any) {
      console.error("[ai-key-readiness] Query failed:", err.message);
      return NextResponse.json({
        encryptionConfigured: isEncryptionAvailable(),
        totalKeys: 0, encryptedKeys: 0, plaintextKeys: 0, disabledKeys: 0,
        ready: false,
        error: "READINESS_QUERY_FAILED",
      }, { status: 503 });
    }
  }

  return NextResponse.json({
    encryptionConfigured,
    totalKeys,
    encryptedKeys,
    plaintextKeys,
    disabledKeys,
    ready: encryptionConfigured && plaintextKeys === 0,
  });
}
