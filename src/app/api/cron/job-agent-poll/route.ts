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

  // Step 0: Clean up any runs stuck in active states for > 180 minutes.
  // Apify scrapes can take up to 2 hours, so 180 minutes safely guarantees we don't kill valid scrapes.
  const cleanedUp = await cleanupStuckRuns(180).catch((err) => {
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
      // Grace period: if the run was created very recently (< 5 minutes ago), it might
      // still be waiting for the Apify call to complete. Skip this tick and retry next poll.
      // Only fail runs that have been stuck without metadata for > 5 minutes.
      const ageMs = Date.now() - new Date(run.started_at ?? run.created_at ?? 0).getTime();
      const GRACE_MS = 5 * 60 * 1000; // 5 minutes
      if (ageMs < GRACE_MS) {
        results.push({ runId: run.id, status: "awaiting_metadata", ageSeconds: Math.round(ageMs / 1000) });
        continue;
      }
      await updateRunStatus(run.id, { status: "failed", error: "Missing Apify metadata (stuck for > 5 min)" });
      results.push({ runId: run.id, error: "Missing Apify metadata (stuck for > 5 min)" });
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
        await processApifyRunData(run.id, run.apify_dataset_id, token, { useAi: true, actorSource: (run.actor_source as any) ?? "indeed" });
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
