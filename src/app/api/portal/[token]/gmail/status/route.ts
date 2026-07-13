import { NextResponse } from "next/server";
import { queryOne } from "@/server/db/neon";

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  let candidate: any;
  let candidateError: any;

  candidate = await queryOne(
    `SELECT id, portal_token_expires_at, portal_token_revoked_at FROM candidates WHERE portal_token = $1`,
    [params.token]
  );
  candidateError = candidate ? null : { message: "Portal link not found." };

  if (candidateError || !candidate) {
    return NextResponse.json({ error: "Portal link not found." }, { status: 404 });
  }
  if (
    candidate.portal_token_revoked_at
    || (candidate.portal_token_expires_at && new Date(candidate.portal_token_expires_at).getTime() < Date.now())
  ) {
    return NextResponse.json({ error: "Portal link expired." }, { status: 410 });
  }

  let data: any;
  let error: any;

  data = await queryOne(
    `SELECT id, provider, owner_type, email, scopes, status, token_expires_at, last_synced_at, created_at, updated_at FROM integration_accounts WHERE provider = 'gmail' AND owner_type = 'candidate' AND candidate_id = $1`,
    [candidate.id]
  );
  error = null;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? null);
}
