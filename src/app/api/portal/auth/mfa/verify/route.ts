import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJWT } from "@/server/auth/jwt";
import { CANDIDATE_MFA_PENDING_COOKIE, createCandidateAuthResponseAfterMfa, findCandidateById } from "@/server/auth/candidateAuth";
import { decryptSecret } from "@/server/security/secretCrypto";
import { queryOne, execute } from "@/server/db/neon";
import { verifyTotp } from "@/server/auth/totp";
import { verifyPassword } from "@/server/auth/crypto";

export async function POST(req: NextRequest) {
  const token = cookies().get(CANDIDATE_MFA_PENDING_COOKIE)?.value;
  const payload = token ? await verifyJWT(token) : null;
  if (!payload?.mfa_pending || payload.type !== "candidate") return NextResponse.json({ error: "MFA challenge expired. Sign in again." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const setting = await queryOne<{ secret_encrypted: string; recovery_code_hashes: string[]; failed_attempts: number; locked_until: string | null }>("SELECT secret_encrypted, recovery_code_hashes, failed_attempts, locked_until FROM candidate_mfa_settings WHERE candidate_id = $1 AND enabled_at IS NOT NULL", [payload.user_id]);
  if (!setting) return NextResponse.json({ error: "MFA is not configured." }, { status: 400 });
  if (setting.locked_until && new Date(setting.locked_until).getTime() > Date.now()) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  const submittedCode = String(body.code ?? "").trim();
  const validTotp = await verifyTotp(await decryptSecret(setting.secret_encrypted), submittedCode);
  let valid = validTotp;
  let usedRecoveryIndex = -1;
  if (!validTotp && Array.isArray(setting.recovery_code_hashes)) {
    for (let i = 0; i < setting.recovery_code_hashes.length; i++) {
      if (await verifyPassword(submittedCode.toUpperCase(), setting.recovery_code_hashes[i])) { valid = true; usedRecoveryIndex = i; break; }
    }
  }
  if (!valid) {
    const attempts = Number(setting.failed_attempts || 0) + 1;
    await execute("UPDATE candidate_mfa_settings SET failed_attempts = $1, locked_until = CASE WHEN $1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END, updated_at = now() WHERE candidate_id = $2", [attempts, payload.user_id]);
    return NextResponse.json({ error: "Invalid authenticator code." }, { status: 401 });
  }
  const candidate = await findCandidateById(payload.user_id);
  if (!candidate) return NextResponse.json({ error: "Candidate account not found." }, { status: 404 });
  await execute("UPDATE candidate_mfa_settings SET failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE candidate_id = $1", [candidate.id]);
  if (usedRecoveryIndex >= 0) await execute("UPDATE candidate_mfa_settings SET recovery_code_hashes = $1 WHERE candidate_id = $2", [JSON.stringify(setting.recovery_code_hashes.filter((_, index) => index !== usedRecoveryIndex)), candidate.id]);
  const response = await createCandidateAuthResponseAfterMfa(candidate);
  response.cookies.set(CANDIDATE_MFA_PENDING_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
