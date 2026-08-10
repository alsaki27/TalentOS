import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, DESTRUCTIVE_MANAGER_ROLES } from "@/lib/auth";
import { hashPassword } from "@/server/auth/crypto";
import { queryOne, execute } from "@/server/db/neon";
import { sendEmail } from "@/lib/emailService";

function temporaryPassword() {
  return `Skarion-${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}!`;
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;
  if (!DESTRUCTIVE_MANAGER_ROLES.includes(context.profile.role)) {
    return NextResponse.json({ error: "Only managers and admins can reset candidate passwords." }, { status: 403 });
  }
  const candidate = await queryOne<{ id: string; name: string; email: string | null; account_email: string | null }>(
    "SELECT id, name, email, account_email FROM candidates WHERE id = $1", [params.id]
  );
  if (!candidate) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  const password = temporaryPassword();
  await execute("UPDATE candidates SET password_hash = $1 WHERE id = $2", [await hashPassword(password), candidate.id]);
  const recipient = candidate.account_email || candidate.email;
  let emailSent = false;
  if (recipient) {
    const result = await sendEmail({
      to: recipient,
      candidateId: candidate.id,
      sentBy: context.profile.user_id,
      subject: "Your temporary Skarion portal password",
      body: `<p>Hi ${candidate.name},</p><p>Your portal password was reset by your Skarion team. Sign in at <a href="${process.env.TALENTOS_BASE_URL || "https://talent.skarion.com"}/portal/login">the candidate portal</a> with this temporary password:</p><p><strong>${password}</strong></p><p>Change it immediately after signing in.</p>`,
    });
    emailSent = result.success;
  }
  return NextResponse.json({ ok: true, temporaryPassword: emailSent ? null : password, emailSent, email: recipient ?? null });
}
