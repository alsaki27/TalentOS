// src/app/api/integrations/crawler/jobs/route.ts
// POST -> a crawler bot pushes one job posting in. Gated by API key validation
// (validateApiKey checks public_api_keys table with jobs:import scope,
// then falls back to CRAWLER_API_KEY env var). This is the same pattern as
// the legacy CRON_SECRET check, but with support for multiple integration keys.

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiKeyAuth";
import { upsertCrawlerJob } from "@/lib/integrations/jobCrawler";

export async function POST(req: NextRequest) {
  const result = await validateApiKey(req);
  if (!result.valid) {
    return result.error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
