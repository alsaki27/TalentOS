// src/app/api/application-queue/page-fit/route.ts
// GET -> lightweight batch refresh of one_page_fit_score/page_fit_metrics for
// a set of application ids. The Application Queue page polls this so a
// manual resume edit in Falood Studio (which recomputes these fields on
// save - see resumePageFitMeasurement.ts) is reflected live, without a full
// page reload. The existing 6s active-workflows poller only patches
// workflow-status fields and never touches these, which is why the overflow
// badge used to only ever update after the AE manually refreshed the page.

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
  if (ids.length === 0) return NextResponse.json({ items: [] });

  const items = await query<{ id: string; one_page_fit_score: number | null; page_fit_metrics: Record<string, unknown> | null }>(
    `SELECT a.id, rv.one_page_fit_score, rv.page_fit_metrics
     FROM applications a
     LEFT JOIN application_resume_versions rv ON rv.id = a.tailored_resume_version_id
     WHERE a.id = ANY($1::uuid[])`,
    [ids]
  );

  return NextResponse.json({ items });
}
