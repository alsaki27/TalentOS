// src/app/api/cron/job-agent/route.ts
// Scheduled daily at 00:00 UTC (6:00 AM Bangladesh time).
// Scrapes each of the 3 combined groups independently with max_results=500.

import { NextRequest, NextResponse } from "next/server";
import { executeRun } from "@/server/services/jobAgentService";
import { getCombinedGroups, getTitlesForGroups } from "@/lib/jobAgentRoleLibrary";
import { recordJobAttempt, recordJobSuccess, recordJobFailure } from "@/server/services/scheduledJobService";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedMs = Date.now();
  await recordJobAttempt("job-agent");

  const combinedGroups = getCombinedGroups();
  const results: { group: string; runId?: string; error?: string }[] = [];
  let hasErrors = false;

  for (const cg of combinedGroups) {
    try {
      // roleGroups already expands to the full title list inside getSearchQueries();
      // passing the same titles again as customKeywords would duplicate every query.
      const result = await executeRun({
        testMode: false,
        useAi: true,
        roleGroups: cg.subGroupIds,
      });
      results.push({ group: cg.label, runId: result.runId });
    } catch (err: any) {
      hasErrors = true;
      results.push({ group: cg.label, error: err.message ?? "Failed" });
    }
  }

  const durationMs = Date.now() - startedMs;
  if (hasErrors) {
    await recordJobFailure("job-agent", "One or more group scrapes failed", durationMs);
  } else {
    await recordJobSuccess("job-agent", durationMs, JSON.stringify(results));
  }

  return NextResponse.json({
    ok: !hasErrors,
    groupsRan: results.length,
    results,
  });
}