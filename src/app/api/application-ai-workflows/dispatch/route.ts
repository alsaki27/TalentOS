import { NextRequest, NextResponse } from "next/server";
import { dispatchNextQueuedWorkflow } from "@/server/services/applicationAiWorkflowService";

export const dynamic = "force-dynamic";

/**
 * POST /api/application-ai-workflows/dispatch
 * Claims and processes the oldest queued workflow.
 * Safe to call repeatedly (idempotent via SKIP LOCKED).
 * Can be triggered by cron or ad-hoc external polling.
 */
export async function POST(_req: NextRequest) {
  const result = await dispatchNextQueuedWorkflow();
  return NextResponse.json(result);
}

/**
 * GET /api/application-ai-workflows/dispatch
 * Same as POST but for cron triggers / health checks.
 */
export async function GET(_req: NextRequest) {
  const result = await dispatchNextQueuedWorkflow();
  return NextResponse.json(result);
}
