// src/app/api/integrations/crawler/jobs/route.ts
// POST -> a crawler bot pushes one job posting in. Gated by CRAWLER_API_KEY (bearer),
// same pattern as CRON_SECRET — checked here and in src/middleware.ts's bypass for this
// path, since an external bot has no session cookie to present.

import { NextRequest, NextResponse } from "next/server";
import { isCrawlerAuthorized, upsertCrawlerJob } from "@/lib/integrations/jobCrawler";

export async function POST(req: NextRequest) {
  if (!isCrawlerAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON body is required" }, { status: 400 });
  }

  try {
    const { job, created } = await upsertCrawlerJob(body);
    return NextResponse.json({ job, created }, { status: created ? 201 : 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to ingest job" }, { status: 400 });
  }
}
