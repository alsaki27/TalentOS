import { NextResponse } from "next/server";
import { queryOne } from "@/server/db/neon";

export const PORTAL_TOKEN_DEFAULT_TTL_DAYS = 90;

export interface CandidateFromToken {
  id: string;
  name: string;
}

export async function requireCandidateByToken(
  token: string
): Promise<
  | { candidate: CandidateFromToken; response: null }
  | { candidate: null; response: NextResponse }
> {
  const candidate = await queryOne<{
    id: string;
    name: string;
    portal_token_expires_at: string | null;
    portal_token_revoked_at: string | null;
  }>(
    `SELECT id, name, portal_token_expires_at, portal_token_revoked_at FROM candidates WHERE portal_token = $1`,
    [token]
  );

  if (!candidate) {
    return {
      candidate: null,
      response: NextResponse.json({ error: "Portal link not found." }, { status: 404 }),
    };
  }

  if (
    candidate.portal_token_revoked_at ||
    (candidate.portal_token_expires_at &&
      new Date(candidate.portal_token_expires_at).getTime() < Date.now())
  ) {
    return {
      candidate: null,
      response: NextResponse.json({ error: "Portal link expired." }, { status: 410 }),
    };
  }

  return {
    candidate: { id: candidate.id, name: candidate.name },
    response: null,
  };
}
