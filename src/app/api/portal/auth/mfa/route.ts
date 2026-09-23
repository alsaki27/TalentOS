import { NextRequest, NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { queryOne, execute } from "@/server/db/neon";
import { createTotpSecret, buildTotpUri, verifyTotp } from "@/server/auth/totp";
import { decryptSecret, encryptSecret, isEncryptionAvailable } from "@/server/security/secretCrypto";
import { hashPassword } from "@/server/auth/crypto";
import { envFlag } from "@/server/runtimeConfig";

function recoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function GET() {
  if (!envFlag("CANDIDATE_MFA_ENABLED")) return NextResponse.json({ error: "MFA_DISABLED" }, { status: 503 });
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  const row = await queryOne<{ enabled_at: string | null }>("SELECT enabled_at FROM candidate_mfa_settings WHERE candidate_id = $1", [context!.candidateId]);
  return NextResponse.json({ enrolled: Boolean(row?.enabled_at) });
}

export async function POST(req: NextRequest) {
  if (!envFlag("CANDIDATE_MFA_ENABLED")) return NextResponse.json({ error: "MFA_DISABLED" }, { status: 503 });
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  if (!isEncryptionAvailable()) return NextResponse.json({ error: "MFA setup is temporarily unavailable. Contact support." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? "").trim();
  const current = await queryOne<{ secret_encrypted: string; enabled_at: string | null }>("SELECT secret_encrypted, enabled_at FROM candidate_mfa_settings WHERE candidate_id = $1", [context!.candidateId]);
  if (current?.enabled_at) return NextResponse.json({ enrolled: true });
  const pending = current;
  if (!code) {
    if (!pending) {
      const secret = createTotpSecret();
      const encryptedSecret = await encryptSecret(secret);
      if (!encryptedSecret.startsWith("enc:")) return NextResponse.json({ error: "MFA_ENCRYPTION_FAILED" }, { status: 503 });
      await execute("INSERT INTO candidate_mfa_settings (candidate_id, secret_encrypted) VALUES ($1, $2) ON CONFLICT (candidate_id) DO UPDATE SET secret_encrypted = EXCLUDED.secret_encrypted, enabled_at = NULL, updated_at = now()", [context!.candidateId, encryptedSecret]);
      return NextResponse.json({ setupRequired: true, secret, otpauthUri: buildTotpUri(secret, context!.candidate.account_email) });
    } else {
      const secret = await decryptSecret(pending.secret_encrypted);
      return NextResponse.json({ setupRequired: true, secret, otpauthUri: buildTotpUri(secret, context!.candidate.account_email) });
    }
  }

  if (!pending) return NextResponse.json({ error: "MFA setup has not been started." }, { status: 400 });
  if (!(await verifyTotp(await decryptSecret(pending.secret_encrypted), code))) return NextResponse.json({ error: "Enter the current 6-digit authenticator code." }, { status: 400 });
  const recoveryCodes = Array.from({ length: 8 }, recoveryCode);
  const recoveryHashes = await Promise.all(recoveryCodes.map(hashPassword));
  await execute("UPDATE candidate_mfa_settings SET enabled_at = now(), recovery_code_hashes = $1, updated_at = now() WHERE candidate_id = $2", [JSON.stringify(recoveryHashes), context!.candidateId]);
  return NextResponse.json({ enrolled: true, recoveryCodes });
}
