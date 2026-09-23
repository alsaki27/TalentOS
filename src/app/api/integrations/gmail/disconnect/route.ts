import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { decryptSecret } from "@/server/security/secretCrypto";

export const dynamic = "force-dynamic";

// Admin/Manager disconnect of a candidate's Gmail — used from the AE Inbox UI
export async function DELETE(req: NextRequest) {
  const { response, context } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  const url = new URL(req.url);
  const candidateId = url.searchParams.get("candidateId");

  if (!candidateId) {
    return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
  }

  const account = await queryOne<{ id: string; email: string | null; access_token: string | null; refresh_token: string | null }>(
    `SELECT id, email, access_token, refresh_token
       FROM integration_accounts
      WHERE provider = 'gmail' AND owner_type = 'candidate' AND candidate_id = $1 AND status != 'revoked'
      LIMIT 1`,
    [candidateId],
  );

  if (!account) {
    return NextResponse.json({ ok: true, alreadyDisconnected: true });
  }

  // Attempt to revoke the token with Google
  let providerRevoked = false;
  const encryptedToken = account.refresh_token || account.access_token;
  if (encryptedToken) {
    try {
      const token = await decryptSecret(encryptedToken);
      const revoke = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
      providerRevoked = revoke.ok;
    } catch {
      providerRevoked = false;
    }
  }

  await queryOne(
    `UPDATE integration_accounts
        SET status = 'revoked', access_token = NULL, refresh_token = NULL,
            token_expires_at = NULL, updated_at = NOW()
      WHERE id = $1`,
    [account.id],
  );

  return NextResponse.json({ ok: true, providerRevoked });
}
