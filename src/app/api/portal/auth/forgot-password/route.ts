import { NextRequest, NextResponse } from "next/server";
import { queryOne, execute } from "@/server/db/neon";
import { sendEmail } from "@/lib/emailService";
import { createHash, randomBytes } from "node:crypto";

export async function POST(req: NextRequest) {
  const { email } = await req.json().catch(() => ({}));
  const normalized = String(email ?? "").trim().toLowerCase();
  const generic = { ok: true, message: "If a portal account exists, a reset link has been sent." };
  if (!normalized) return NextResponse.json(generic);
  const candidate = await queryOne<{ id: string; name: string; email: string | null; account_email: string | null }>(
    "SELECT id, name, email, account_email FROM candidates WHERE LOWER(COALESCE(account_email, email)) = $1", [normalized]
  );
  if (!candidate) return NextResponse.json(generic);
  const token = randomBytes(32).toString("hex");
  await execute("UPDATE candidate_password_resets SET used_at = NOW() WHERE candidate_id = $1 AND used_at IS NULL", [candidate.id]);
  await execute("INSERT INTO candidate_password_resets(candidate_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')", [candidate.id, createHash("sha256").update(token).digest("hex")]);
  const url = `${process.env.TALENTOS_BASE_URL || "https://talent.skarion.com"}/portal/reset-password?token=${token}`;
  await sendEmail({ to: candidate.account_email || candidate.email!, candidateId: candidate.id, subject: "Reset your Skarion portal password", body: `<p>Hi ${candidate.name},</p><p><a href="${url}">Reset your password</a>. This link expires in 30 minutes.</p>` });
  return NextResponse.json(generic);
}
