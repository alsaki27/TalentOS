// src/app/api/application-queue/route.ts
// GET -> paginated/filterable assigned/stacked application work tickets

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { QUEUE_ACTIVITY_WINDOWS, parseQueueSort } from "@/lib/applicationQueueFilters";
import { listApplicationQueue, listApplicationQueueCandidates } from "@/server/repositories/applicationsRepository";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const stage = url.searchParams.get("stage") || "";
  const owner = url.searchParams.get("owner") || "";
  const priority = url.searchParams.get("priority") || "";
  const review = url.searchParams.get("review") || "";
  const view = url.searchParams.get("view") || "all";
  const candidateId = url.searchParams.get("candidate_id") || "";
  const workMode = url.searchParams.get("work_mode") || "";
  const fitScoreBand = url.searchParams.get("fit_score") || "";
  const timeWindow = url.searchParams.get("time_window") || "";
  const timeWindowMinutes = QUEUE_ACTIVITY_WINDOWS.find((window) => window.value === timeWindow)?.minutes ?? null;
  const sort = parseQueueSort(url.searchParams.get("sort"));
  const sortDirection = url.searchParams.get("direction") === "asc" ? "asc" : "desc";

  try {
    if (url.searchParams.get("options") === "candidates") {
      return NextResponse.json(await listApplicationQueueCandidates());
    }
    const result = await listApplicationQueue({
      page,
      pageSize,
      search,
      candidateId,
      stage,
      owner,
      priority,
      review,
      view,
      workMode,
      fitScoreBand,
      userId: context!.profile.user_id,
      userEmail: context!.profile.email ?? null,
      userDisplayName: context!.profile.display_name ?? null,
      userRole: context!.profile.role,
      timeWindowMinutes,
      sort,
      sortDirection,
    });

    return NextResponse.json({ items: result.items, total: result.total, page, pageSize, stats: result.stats });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
