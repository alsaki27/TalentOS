// src/app/api/portal/me/dashboard/route.ts
// Authenticated replacement for the anonymous-token route's data shape, scoped
// to the logged-in candidate's session instead of a URL token. Query logic lives
// in src/lib/portalDashboard.ts, shared with /api/portal/[token] (which stays
// live and unchanged for the pre-existing anonymous-link flow).

import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import {
  buildCandidatePortalDashboardPage,
  type CandidatePortalDateRange,
  type CandidatePortalResumeFilter,
  type CandidatePortalSort,
} from "@/lib/candidatePortalDashboardService";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;

  const url = new URL(req.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "10");
  const dateRange = url.searchParams.get("dateRange") as CandidatePortalDateRange | null;
  const resumeStatus = url.searchParams.get("resumeStatus") as CandidatePortalResumeFilter | null;
  const sort = url.searchParams.get("sort") as CandidatePortalSort | null;
  const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";

  const dashboard = await buildCandidatePortalDashboardPage(context.candidateId, context.candidate.name, {
    page,
    pageSize,
    search: url.searchParams.get("search") ?? "",
    status: url.searchParams.get("status") ?? "",
    source: url.searchParams.get("source") ?? "",
    dateRange: dateRange ?? "all",
    resumeStatus: resumeStatus ?? "all",
    sort: sort ?? "submitted_at",
    order,
  });
  return NextResponse.json(dashboard);
}
