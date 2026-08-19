import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const candidateId = url.searchParams.get("candidateId");

  let data: any;

  if (candidateId) {
    data = await query(
      `SELECT candidate_id FROM integration_accounts
       WHERE provider = 'gmail' AND owner_type = 'candidate' AND candidate_id = $1 AND status != 'revoked'`,
      [candidateId]
    );
  } else {
    data = await query(
      `SELECT candidate_id FROM integration_accounts
       WHERE provider = 'gmail' AND owner_type = 'candidate' AND status != 'revoked' AND candidate_id IS NOT NULL`
    );
  }

  const connectedIds = (data ?? []).map((row: any) => row.candidate_id);
  return NextResponse.json({ connected_candidates: connectedIds });
}
