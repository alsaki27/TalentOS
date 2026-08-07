// src/app/api/portal/[token]/route.ts
// GET -> read-only candidate portal data, looked up by magic-link token (no login).
// Deliberately returns a minimal slice: name + submitted applications (not pre-submission
// assigned/stacked/in_progress pipeline tickets) + only comments flagged
// visible_to_candidate. Internal notes, assignment metadata, and other candidates'
// data are never exposed here. Query logic lives in src/lib/portalDashboard.ts,
// shared with /api/portal/me/dashboard so it isn't duplicated across both routes.

import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/server/db/neon";
import { buildCandidatePortalDashboard } from "@/lib/portalDashboard";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const candidate = await queryOne<{ id: string; name: string; skarion_enrolled_at: string | null; portal_token_expires_at: string | null; portal_token_revoked_at: string | null }>(
    `SELECT id, name, skarion_enrolled_at, portal_token_expires_at, portal_token_revoked_at FROM candidates WHERE portal_token = $1`,
    [params.token]
  );

  if (!candidate) {
    return NextResponse.json({ error: "Portal link not found." }, { status: 404 });
  }
  if (
    candidate.portal_token_revoked_at
    || (candidate.portal_token_expires_at && new Date(candidate.portal_token_expires_at).getTime() < Date.now())
  ) {
    return NextResponse.json({ error: "Portal link expired." }, { status: 410 });
  }

  const dashboard = await buildCandidatePortalDashboard(candidate.id, candidate.name);
  return NextResponse.json({ ...dashboard, skarionEnrolledAt: candidate.skarion_enrolled_at });
}
