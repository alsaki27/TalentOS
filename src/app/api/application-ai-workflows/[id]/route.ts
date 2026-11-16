import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { cancelWorkflow, retryWorkflow, restartWorkflow, rerunFromStage } from "@/server/services/applicationAiWorkflowService";
import { findWorkflowById, listStageRuns, listArtifacts } from "@/server/repositories/applicationAiWorkflowRepository";

export const dynamic = "force-dynamic";

// Status/detail lookup — used by the Application Queue's "▼ Details" expand
// (src/app/application-queue/page.tsx's fetchWorkflowDetails, ?action=status)
// and by the E2E workflow-verification test. Never had a GET handler at all
// (only POST for cancel/retry/restart/rerun) - both callers were silently
// getting a 405 (frontend swallows it in an empty catch, no UI symptom).
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const workflowId = params.id;
  const wf = await findWorkflowById(workflowId);
  if (!wf) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  const [stages, artifacts] = await Promise.all([
    listStageRuns(workflowId),
    listArtifacts(workflowId),
  ]);

  return NextResponse.json({ workflow: wf, stages, artifacts });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
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
      if (!await cancelWorkflow(workflowId)) {
        return NextResponse.json({ error: "Workflow is no longer eligible for cancellation" }, { status: 409 });
      }
      return NextResponse.json({ workflowId, status: "cancelled" });
    }

    case "retry": {
      if (wf.status !== "failed" && wf.status !== "cancelled") {
        return NextResponse.json({ error: `Can only retry failed or cancelled workflows, current: ${wf.status}` }, { status: 400 });
      }
      if (!await retryWorkflow(workflowId)) {
        return NextResponse.json({ error: "Workflow is no longer eligible for retry" }, { status: 409 });
      }
      return NextResponse.json({ workflowId, status: "queued" });
    }

    case "restart": {
      if (wf.status !== "failed" && wf.status !== "cancelled") {
        return NextResponse.json({ error: `Can only restart failed or cancelled workflows, current: ${wf.status}` }, { status: 400 });
      }
      if (!await restartWorkflow(workflowId)) {
        return NextResponse.json({ error: "Workflow is no longer eligible for restart" }, { status: 409 });
      }
      return NextResponse.json({ workflowId, status: "queued", fromStage: 0 });
    }

    case "rerun": {
      const stageStr = url.searchParams.get("stage");
      const stage = stageStr === null ? 0 : /^\d+$/.test(stageStr) ? Number(stageStr) : NaN;
      if (!Number.isSafeInteger(stage) || stage < 0) {
        return NextResponse.json({ error: "Invalid stage parameter" }, { status: 400 });
      }
      if (!await rerunFromStage(workflowId, stage)) {
        return NextResponse.json({ error: "Workflow has an active claim or the requested stage is unavailable" }, { status: 409 });
      }
      return NextResponse.json({ workflowId, status: "queued", fromStage: stage });
    }

    case "move":
      return NextResponse.json({ error: "Pipeline stages advance through verified workflow results" }, { status: 405 });

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
