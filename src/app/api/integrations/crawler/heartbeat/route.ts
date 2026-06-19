// src/app/api/integrations/crawler/heartbeat/route.ts
// POST -> a crawler bot reports it's alive. Gated by API key validation
// (validateApiKey checks public_api_keys table with jobs:import scope,
// then falls back to CRAWLER_API_KEY env var).

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiKeyAuth";
import { recordHeartbeat } from "@/lib/integrations/jobCrawler";

export async function POST(req: NextRequest) {
  const result = await validateApiKey(req);
  if (!result.valid) {
    return result.error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const crawlerName = String(body.crawlerName ?? "").trim();
  if (!crawlerName) {
    return NextResponse.json({ error: "crawlerName is required" }, { status: 400 });
  }

  try {
    const status = await recordHeartbeat(crawlerName, body.isActive !== false, body.message);
    return NextResponse.json(status);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Failed to record heartbeat" }, { status: 400 });
  }
}
