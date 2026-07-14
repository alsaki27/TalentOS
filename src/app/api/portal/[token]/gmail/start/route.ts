import { NextRequest, NextResponse } from "next/server";
import { gmailAuthUrl, newOAuthState } from "@/lib/integrations/googleGmail";
import { execute } from "@/server/db/neon";
import { requireCandidateByToken } from "@/lib/portalAuth";

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const { candidate, response } = await requireCandidateByToken(params.token);
  if (response) return response;

  const url = new URL(req.url);
  const state = newOAuthState();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await execute(
    "INSERT INTO integration_oauth_states (state, provider, owner_type, candidate_id, redirect_after, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [state, "gmail", "candidate", candidate.id, `/portal/${params.token}`, expiresAt]
  );

  return NextResponse.redirect(gmailAuthUrl({ state, origin: url.origin }));
}
