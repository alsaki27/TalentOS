// src/app/api/job-agent/runs/cleanup/route.ts
// POST: Mark all runs stuck in running/pending/processing > 30min as failed.
// Called by the admin "Clear Stuck Runs" button on the Job Agent page.

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { cleanupStuckRuns } from "@/server/repositories/jobAgentRunRepository";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  try {
    const count = await cleanupStuckRuns(120); // 120 min — Google actor can legitimately run >30 min
    return NextResponse.json({ ok: true, cleanedUp: count });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Cleanup failed" }, { status: 500 });
  }
}
