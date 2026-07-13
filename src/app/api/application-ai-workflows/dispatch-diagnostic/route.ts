// POST /api/application-ai-workflows/dispatch-diagnostic
// NO backgroundDispatch, NO self-fetch. Directly calls dispatchNextQueuedWorkflow
// and returns the full result + logs. Use this when a workflow is stuck on
// "queued" and the normal dispatch chain isn't firing — it isolates whether
// the issue is in the claim/stage pipeline or in the backgroundDispatch
// registration.

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { dispatchNextQueuedWorkflow } from "@/server/services/applicationAiWorkflowService";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  try {
    console.log(`[Dispatch Chain] DIAGNOSTIC: direct dispatchNextQueuedWorkflow call (bypassing backgroundDispatch)`);
    const result = await dispatchNextQueuedWorkflow();
    console.log(`[Dispatch Chain] DIAGNOSTIC result:`, JSON.stringify(result));
    return NextResponse.json({
      mode: "diagnostic",
      result,
      note: "This bypassed backgroundDispatch. If the result shows dispatched:true, the claim+stage pipeline works — the issue is in backgroundDispatch/waitUntil. If dispatched:false with 'No queued workflows', the workflow isn't in queued status or claimNextPendingWorkflow's concurrency cap is blocking it.",
    });
  } catch (err: any) {
    console.error(`[Dispatch Chain] DIAGNOSTIC error:`, err);
    return NextResponse.json({
      mode: "diagnostic",
      error: err?.message ?? String(err),
      stack: err?.stack ?? null,
    }, { status: 500 });
  }
}