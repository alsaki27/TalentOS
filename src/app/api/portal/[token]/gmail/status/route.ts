import { NextResponse } from "next/server";
import { queryOne } from "@/server/db/neon";
import { requireCandidateByToken } from "@/lib/portalAuth";

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const { candidate, response } = await requireCandidateByToken(params.token);
  if (response) return response;

  const data = await queryOne(
    `SELECT id, provider, owner_type, email, scopes, status, token_expires_at, last_synced_at, created_at, updated_at FROM integration_accounts WHERE provider = 'gmail' AND owner_type = 'candidate' AND candidate_id = $1`,
    [candidate.id]
  );

  return NextResponse.json(data ?? null);
}
