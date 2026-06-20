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
  const owner = url.searchParams.get("owner") || "";
  const priority = url.searchParams.get("priority") || "";
  const review = url.searchParams.get("review") || "";
  const view = url.searchParams.get("view") || "all";

  try {
    const result = await listApplicationQueue({
      page,
      pageSize,
      search,
      status,
      owner,
      priority,
      review,
      view: view as "all" | "mine" | "overdue" | "review",
      userId: context!.profile.user_id,
      userEmail: context!.profile.email ?? null,
      userDisplayName: context!.profile.display_name ?? null,
      userRole: context!.profile.role,
      pipelineStatuses: ["assigned", "stacked", "in_progress"],
    });

    return NextResponse.json({ items: result.items, total: result.total, page, pageSize, stats: result.stats });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
