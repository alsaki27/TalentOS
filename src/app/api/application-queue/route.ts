// src/app/api/application-queue/route.ts
// GET -> paginated/filterable assigned/stacked application work tickets

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { listApplicationQueue } from "@/server/repositories/applicationsRepository";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const status = url.searchParams.get("status") || "";
  const stage = url.searchParams.get("stage") || "";
  const owner = url.searchParams.get("owner") || "";
  const priority = url.searchParams.get("priority") || "";
  const review = url.searchParams.get("review") || "";
  const view = url.searchParams.get("view") || "all";
  const candidateId = url.searchParams.get("candidate_id") || "";
  const appliedOnly = url.searchParams.get("applied_only") === "1";
  const timeWindow = url.searchParams.get("time_window") || "";
  const timeWindowHours = ({ "12h": 12, "24h": 24, "3d": 72, "7d": 168 } as Record<string, number>)[timeWindow] ?? null;
  const requestedSort = url.searchParams.get("sort");
  const sort = requestedSort === "final_score" || requestedSort === "average_score" ? requestedSort : "due";
  const sortDirection = url.searchParams.get("direction") === "asc" ? "asc" : "desc";

  try {
    const result = await listApplicationQueue({
      page,
      pageSize,
      search,
      candidateId,
      status,
      stage,
      owner,
      priority,
      review,
      view: view as "all" | "mine" | "ae_review" | "ae_application",
      userId: context!.profile.user_id,
      userEmail: context!.profile.email ?? null,
      userDisplayName: context!.profile.display_name ?? null,
      userRole: context!.profile.role,
      pipelineStatuses: appliedOnly ? ["applied"] : ["assigned", "stacked", "in_progress"],
      timeWindowHours,
      sort,
      sortDirection,
    });

    return NextResponse.json({ items: result.items, total: result.total, page, pageSize, stats: result.stats });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
