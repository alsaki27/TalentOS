import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { cancelWorkflow, retryWorkflow, restartWorkflow, rerunFromStage, dispatchWorkflowById } from "@/server/services/applicationAiWorkflowService";
import { findWorkflowById } from "@/server/repositories/applicationAiWorkflowRepository";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const workflowId = params.id;
  const wf = await findWorkflowById(workflowId);
  if (!wf) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "cancel";

  switch (action) {
    case "cancel": {
      if (wf.status !== "queued" && wf.status !== "running" && wf.status !== "waiting") {
        return NextResponse.json({ error: `Cannot cancel workflow in '${wf.status}' state` }, { status: 400 });
      }
      await cancelWorkflow(workflowId);
      return NextResponse.json({ workflowId, status: "cancelled" });
    }

    case "retry": {
      if (wf.status !== "failed" && wf.status !== "cancelled") {
        return NextResponse.json({ error: `Can only retry failed or cancelled workflows, current: ${wf.status}` }, { status: 400 });
      }
      await retryWorkflow(workflowId);
      // Fire-and-forget: respond immediately so the caller isn't blocked;
      // the dispatcher handles stage processing asynchronously in the background.
      dispatchWorkflowById(workflowId).catch((err) => {
        console.error(`[Workflow ${workflowId}] Retry dispatch failed:`, err);
      });
      return NextResponse.json({ workflowId, status: "queued" });
    }

    case "restart": {
      if (wf.status !== "failed" && wf.status !== "cancelled") {
        return NextResponse.json({ error: `Can only restart failed or cancelled workflows, current: ${wf.status}` }, { status: 400 });
      }
      await restartWorkflow(workflowId);
      dispatchWorkflowById(workflowId).catch((err) => {
        console.error(`[Workflow ${workflowId}] Restart dispatch failed:`, err);
      });
      return NextResponse.json({ workflowId, status: "queued", fromStage: 0 });
    }

    case "rerun": {
      const stageStr = url.searchParams.get("stage");
      const stage = stageStr ? parseInt(stageStr, 10) : 0;
      if (isNaN(stage) || stage < 0) {
        return NextResponse.json({ error: "Invalid stage parameter" }, { status: 400 });
      }
      await rerunFromStage(workflowId, stage);
      // Fire-and-forget: respond immediately, dispatch runs in background
      dispatchWorkflowById(workflowId).catch((err) => {
        console.error(`[Workflow ${workflowId}] Rerun dispatch failed:`, err);
      });
      return NextResponse.json({ workflowId, status: "queued", fromStage: stage });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
