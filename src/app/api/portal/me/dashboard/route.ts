// src/app/api/portal/me/dashboard/route.ts
// Authenticated replacement for the anonymous-token route's data shape, scoped
// to the logged-in candidate's session instead of a URL token. Query logic lives
// in src/lib/portalDashboard.ts, shared with /api/portal/[token] (which stays
// live and unchanged for the pre-existing anonymous-link flow).

import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { buildCandidatePortalDashboard } from "@/lib/portalDashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;

  const dashboard = await buildCandidatePortalDashboard(context.candidateId, context.candidate.name);
  return NextResponse.json(dashboard);
}
