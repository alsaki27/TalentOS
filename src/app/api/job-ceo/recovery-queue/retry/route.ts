import { NextRequest, NextResponse } from "next/server";
import { processRecoveryRetryBatch } from "@/server/services/jobCeoRecoveryRetryService";

export const dynamic = "force-dynamic";

// Scheduled, machine-to-machine endpoint (CRON_SECRET bearer, exempted from
// the staff-session gate in src/middleware.ts the same way /dispatch and
// /enrich are) — re-attempts the fetch for a batch of jobs stuck at
// stage='no_description', across every ingest source. See
// .github/workflows/scheduled-jobs.yml's job-ceo-recovery-retry job, which
// calls this every 15 minutes.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processRecoveryRetryBatch();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
