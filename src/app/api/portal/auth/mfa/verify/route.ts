import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyJWT } from "@/server/auth/jwt";
import { CANDIDATE_MFA_PENDING_COOKIE, createCandidateAuthResponseAfterMfa, findCandidateById } from "@/server/auth/candidateAuth";
import { decryptSecret } from "@/server/security/secretCrypto";
import { queryOne } from "@/server/db/neon";
import { verifyTotp } from "@/server/auth/totp";
import { verifyPassword } from "@/server/auth/crypto";
import { envFlag } from "@/server/runtimeConfig";

type MfaSetting = {
  secret_encrypted: string;
  recovery_code_hashes: string[];
  failed_attempts: number;
  locked_until: string | null;
};

export async function POST(req: NextRequest) {
  if (!envFlag("CANDIDATE_MFA_ENABLED")) return NextResponse.json({ error: "MFA_DISABLED" }, { status: 503 });
  const token = cookies().get(CANDIDATE_MFA_PENDING_COOKIE)?.value;
  const payload = token ? await verifyJWT(token) : null;
  if (!payload?.mfa_pending || payload.type !== "candidate") {
    return NextResponse.json({ error: "MFA challenge expired. Sign in again." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const submittedCode = String(body.code ?? "").trim();
  const normalizedRecoveryCode = submittedCode.replace(/[\s-]/g, "").toUpperCase();
  const setting = await queryOne<MfaSetting>(
    "SELECT secret_encrypted, recovery_code_hashes, failed_attempts, locked_until FROM candidate_mfa_settings WHERE candidate_id = $1 AND enabled_at IS NOT NULL",
    [payload.user_id],
  );
  if (!setting) return NextResponse.json({ error: "MFA is not configured." }, { status: 400 });
  if (setting.locked_until && new Date(setting.locked_until).getTime() > Date.now()) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const validTotp = await verifyTotp(await decryptSecret(setting.secret_encrypted), submittedCode);
  let recoveryIndex = -1;
  if (!validTotp && /^[A-F0-9]{16}$/.test(normalizedRecoveryCode) && Array.isArray(setting.recovery_code_hashes)) {
    for (let index = 0; index < setting.recovery_code_hashes.length; index += 1) {
      if (await verifyPassword(normalizedRecoveryCode, setting.recovery_code_hashes[index])) {
        recoveryIndex = index;
        break;
      }
    }
  }

  if (!validTotp && recoveryIndex < 0) {
    const attempts = await queryOne<{ failed_attempts: number; locked_until: string | null }>(
      `UPDATE candidate_mfa_settings
          SET failed_attempts = failed_attempts + 1,
              locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE NULL END,
              updated_at = NOW()
        WHERE candidate_id = $1
          AND (locked_until IS NULL OR locked_until <= NOW())
        RETURNING failed_attempts, locked_until`,
      [payload.user_id],
    );
    return NextResponse.json(
      { error: attempts?.locked_until ? "Too many attempts. Try again later." : "Invalid authentication code." },
      { status: attempts?.locked_until ? 429 : 401 },
    );
  }

  if (recoveryIndex >= 0) {
    const remainingHashes = setting.recovery_code_hashes.filter((_, index) => index !== recoveryIndex);
    const consumed = await queryOne<{ candidate_id: string }>(
      `UPDATE candidate_mfa_settings
          SET recovery_code_hashes = $1::jsonb,
              failed_attempts = 0,
              locked_until = NULL,
              updated_at = NOW()
        WHERE candidate_id = $2
          AND recovery_code_hashes = $3::jsonb
        RETURNING candidate_id`,
      [JSON.stringify(remainingHashes), payload.user_id, JSON.stringify(setting.recovery_code_hashes)],
    );
    if (!consumed) return NextResponse.json({ error: "Recovery code was already used. Try another code." }, { status: 409 });
  } else {
    await queryOne(
      `UPDATE candidate_mfa_settings
          SET failed_attempts = 0, locked_until = NULL, updated_at = NOW()
        WHERE candidate_id = $1
        RETURNING candidate_id`,
      [payload.user_id],
    );
  }

  const candidate = await findCandidateById(payload.user_id);
  if (!candidate) return NextResponse.json({ error: "Candidate account not found." }, { status: 404 });
  const response = await createCandidateAuthResponseAfterMfa(candidate);
  response.cookies.set(CANDIDATE_MFA_PENDING_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
