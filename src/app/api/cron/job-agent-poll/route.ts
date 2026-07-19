// src/app/api/cron/job-agent-poll/route.ts
// Scheduled every minute (or similar) to poll running Apify jobs.
// This prevents Cloudflare Worker timeouts during long scraping runs.
// Also cleans up runs stuck in running/pending/processing for more than 30 minutes.

import { NextRequest, NextResponse } from "next/server";
import { listRunningRuns, updateRunStatus, cleanupStuckRuns } from "@/server/repositories/jobAgentRunRepository";
import { getTokenById } from "@/server/repositories/jobAgentTokenRepository";
import { checkApifyRunStatus, processApifyRunData } from "@/server/services/jobAgentService";

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

  // Step 0: Clean up any runs stuck in active states for > 30 minutes.
  const cleanedUp = await cleanupStuckRuns(30).catch((err) => {
    console.error("[job-agent-poll] cleanupStuckRuns error:", err.message);
    return 0;
  });

  const runningRuns = await listRunningRuns();
  if (runningRuns.length === 0) {
    return NextResponse.json({ ok: true, message: "No active runs to poll", cleanedUp });
  }

  const results: any[] = [];
  let processed = 0;

  for (const run of runningRuns) {
    if (!run.apify_run_id || !run.apify_dataset_id || !run.token_id) {
      await updateRunStatus(run.id, { status: "failed", error: "Missing Apify metadata" });
      results.push({ runId: run.id, error: "Missing Apify metadata" });
      continue;
    }

    try {
      const token = await getTokenById(run.token_id);
      if (!token) {
        await updateRunStatus(run.id, { status: "failed", error: "Token not found" });
        results.push({ runId: run.id, error: "Token not found" });
        continue;
      }

      const status = await checkApifyRunStatus(run.apify_run_id, token);

      if (status === "SUCCEEDED") {
        // Use an atomic status transition as a distributed mutex to prevent
        // double-processing. Only the first caller that transitions from 'running' wins.
        try {
          await updateRunStatus(run.id, { status: "processing" });
        } catch {
          // Another process already transitioned this run; skip it.
          results.push({ runId: run.id, status: "already_processing" });
          continue;
        }
        await processApifyRunData(run.id, run.apify_dataset_id, token, { useAi: true });
        results.push({ runId: run.id, status: "processed" });
        processed++;
      } else if (["FAILED", "ABORTED", "TIMED-OUT"].includes(status)) {
        await updateRunStatus(run.id, { status: "failed", error: `Apify run ended with status ${status}` });
        results.push({ runId: run.id, status: "failed_on_apify" });
      } else {
        // Still running on Apify (e.g. RUNNING, READY), do nothing, check again next minute.
        results.push({ runId: run.id, status: "still_running" });
      }
    } catch (err: any) {
      results.push({ runId: run.id, error: err.message });
      console.error(`[job-agent-poll] Error polling run ${run.id}:`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    cleanedUp,
    polled: runningRuns.length,
    processed,
    results
  });
}
