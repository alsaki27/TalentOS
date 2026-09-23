import { NextResponse } from "next/server";
import { findCandidateByPortalToken } from "@/server/auth/candidateAuth";

// Public lookup so the invite-acceptance page can render the candidate's name
// and whether the invite was already claimed, before any auth exists yet.
export async function GET(_req: Request, { params }: { params: { token: string } }) {
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

  return NextResponse.json({
    name: candidate.name,
    email: candidate.email,
    alreadyClaimed: Boolean(candidate.account_created_at),
  });
}
