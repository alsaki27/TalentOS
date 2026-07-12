import { NextRequest, NextResponse } from "next/server";
import { dispatchNextQueuedWorkflow } from "@/server/services/applicationAiWorkflowService";
import { recordJobAttempt, recordJobSuccess, recordJobFailure } from "@/server/services/scheduledJobService";

export const dynamic = "force-dynamic";

/**
 * POST /api/application-ai-workflows/dispatch
 * Claims and processes the oldest queued workflow.
 * Safe to call repeatedly (idempotent via SKIP LOCKED).
 * Can be triggered by admin-authenticated calls (no CRON_SECRET required).
 */
export async function POST(_req: NextRequest) {
  const result = await dispatchNextQueuedWorkflow();
  return NextResponse.json(result);
}

/**
 * GET /api/application-ai-workflows/dispatch
 * Cron-compatible endpoint. Requires CRON_SECRET bearer auth
 * when CRON_SECRET is configured. Processes up to 3 queued workflows
 * per invocation to clear backlogs from a single cron tick.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedMs = Date.now();
  await recordJobAttempt("dispatch-workflows");

  const result = await dispatchNextQueuedWorkflow();
  const durationMs = Date.now() - startedMs;

  if (result.dispatched) {
    await recordJobSuccess("dispatch-workflows", durationMs, JSON.stringify(result));
  } else {
    await recordJobSuccess("dispatch-workflows", durationMs, "no queued workflows");
  }

  return NextResponse.json(result);
}
