// src/app/api/cron/categorize-jobs/route.ts
// GET -> safety net for job categorization. The primary mechanism is the client-driven
// batch loop right after import (src/app/jobs/page.tsx -> /api/jobs/categorize/process);
// this catches anything left pending if a browser tab closed mid-import or a large bulk
// import wasn't fully drained. Same CRON_SECRET bearer pattern as the other
// /api/cron/* routes (see src/app/api/cron/digest/route.ts) and vercel.json.

import { NextRequest, NextResponse } from "next/server";
import { processPendingCategorization } from "@/lib/ai/jobCategorization";

export const dynamic = "force-dynamic";

const MAX_BATCHES = 10; // up to 10 * 20 = 200 jobs per cron run, bounded to stay within function timeout

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let totalProcessed = 0;
  let totalFailed = 0;
  let remainingPending = 0;

  for (let i = 0; i < MAX_BATCHES; i++) {
    const result = await processPendingCategorization({ limit: 20, triggeredBy: "cron" });
    totalProcessed += result.processed;
    totalFailed += result.failed;
    remainingPending = result.remainingPending;
    if (remainingPending === 0 || (result.processed === 0 && result.failed === 0)) break;
  }

  return NextResponse.json({ processed: totalProcessed, failed: totalFailed, remainingPending });
}
