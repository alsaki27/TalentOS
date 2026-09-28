// src/app/api/application-queue/bulk-retry/route.ts
// POST -> retry every AI workflow the caller selected on the Application
// Queue page's "Retry selected" button.

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { retryWorkflow, dispatchNextQueuedWorkflow } from "@/server/services/applicationAiWorkflowService";
import { backgroundDispatch } from "@/server/lib/waitUntil";

export const dynamic = "force-dynamic";

// Uses the exact same retryWorkflow() the single-ticket "Retry" action and
// the admin retry-failed-since job use: resumes each workflow from its
// current stage, keeping existing progress/artifacts, rather than a full
// restart from scratch (that's "Regenerate" - a separate, more destructive
// action already on this page, deliberately left untouched here).
export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  const workflowIds: string[] = Array.isArray(body?.workflowIds)
    ? body.workflowIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
    : [];

  if (workflowIds.length === 0) {
    return NextResponse.json({ error: "workflowIds is required and must be a non-empty array." }, { status: 400 });
  }
  if (workflowIds.length > 100) {
    return NextResponse.json({ error: "Too many workflows in one request (max 100)." }, { status: 400 });
  }

  let retried = 0;
  const errors: { workflowId: string; message: string }[] = [];
  for (const workflowId of workflowIds) {
    try {
      // retryWorkflow() is itself a safe no-op for anything not currently
      // failed/cancelled (see its own guard) - this loop can never
      // accidentally touch a healthy ticket even if a stale id slipped
      // through from the client.
      await retryWorkflow(workflowId);
      retried++;
    } catch (err: any) {
      errors.push({ workflowId, message: err?.message ?? String(err) });
    }
  }

  // Same reasoning as /api/admin/retry-failed-since: don't make the caller
  // wait out the full 5-minute cron cycle for a queue they just explicitly
  // asked to retry. One kick starts the ball rolling; the cron dispatcher
  // picks up whatever's left.
  if (retried > 0) {
    backgroundDispatch(
      dispatchNextQueuedWorkflow().catch((err) => {
        console.error("[application-queue/bulk-retry] Dispatch kick failed:", err);
      })
    );
  }

  return NextResponse.json({ retried, requested: workflowIds.length, errors });
}
