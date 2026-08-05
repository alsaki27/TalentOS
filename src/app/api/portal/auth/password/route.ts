import { NextRequest, NextResponse } from "next/server";
import { getCurrentCandidateContext } from "@/server/auth/candidateAuth";
import { hashPassword, verifyPassword } from "@/server/auth/crypto";
import { execute } from "@/server/db/neon";

// Logged-in password change. Initial password set during invite acceptance goes
// through /api/portal/invite/[token]/complete instead (no existing password yet).
export async function PATCH(req: NextRequest) {
  const context = await getCurrentCandidateContext();
  if (!context) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await req.json();
  const currentPassword = String(body.current_password ?? "");
  const newPassword = String(body.password ?? "");

  if (newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }

  if (context.candidate.password_hash) {
    if (!currentPassword) {
      return NextResponse.json({ error: "Current password is required." }, { status: 400 });
    }
    const valid = await verifyPassword(currentPassword, context.candidate.password_hash);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }
  }

  const newHash = await hashPassword(newPassword);
  await execute("UPDATE candidates SET password_hash = $1 WHERE id = $2", [newHash, context.candidateId]);

  return NextResponse.json({ ok: true });
}
