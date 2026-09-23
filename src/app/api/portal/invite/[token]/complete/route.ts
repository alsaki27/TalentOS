import { NextRequest, NextResponse } from "next/server";
import { findCandidateByPortalToken, createCandidateAuthResponse } from "@/server/auth/candidateAuth";
import { hashPassword } from "@/server/auth/crypto";
import { execute } from "@/server/db/neon";

// Sets a password for an invited candidate and creates their account. Google-only
// signups skip this and go straight through /api/portal/auth/google/callback instead.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const candidate = await findCandidateByPortalToken(params.token);
  if (!candidate) {
    return NextResponse.json({ error: "Invite link not found." }, { status: 404 });
  }
  if (
    candidate.portal_token_revoked_at ||
    (candidate.portal_token_expires_at && new Date(candidate.portal_token_expires_at).getTime() < Date.now())
  ) {
    return NextResponse.json({ error: "Invite link expired." }, { status: 410 });
  }
  if (candidate.account_created_at) {
    return NextResponse.json({ error: "This invite has already been used. Please log in instead." }, { status: 409 });
  }

  const body = await req.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  await execute(
    "UPDATE candidates SET account_email = $1, password_hash = $2, account_created_at = NOW() WHERE id = $3",
    [email, passwordHash, candidate.id]
  );

  return createCandidateAuthResponse({ id: candidate.id, account_email: email });
}
