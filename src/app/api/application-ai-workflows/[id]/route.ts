import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { cancelWorkflow, retryWorkflow, restartWorkflow, rerunFromStage, dispatchWorkflowById } from "@/server/services/applicationAiWorkflowService";
import { findWorkflowById, listStageRuns, listArtifacts, updateWorkflowStatus } from "@/server/repositories/applicationAiWorkflowRepository";
import { advanceAeStageAfterAiCompletion } from "@/server/repositories/applicationsRepository";
import { backgroundDispatch } from "@/server/lib/waitUntil";

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
      // Registered with ctx.waitUntil via backgroundDispatch so it survives
      // past this response instead of racing it (see waitUntil.ts) - a plain
      // un-awaited call here was confirmed to get killed before the stage
      // dispatcher ever ran.
      const baseUrl = process.env.TALENTOS_BASE_URL || 'https://talent.skarion.com';
      await backgroundDispatch(
        fetch(`${baseUrl}/api/application-ai-workflows/dispatch`, {
          method: 'POST'
        }).catch((err) => {
          console.error(`[Workflow ${workflowId}] Retry dispatch fetch failed:`, err);
        })
      );
      return NextResponse.json({ workflowId, status: "queued" });
    }

    case "restart": {
      if (wf.status !== "failed" && wf.status !== "cancelled") {
        return NextResponse.json({ error: `Can only restart failed or cancelled workflows, current: ${wf.status}` }, { status: 400 });
      }
      await restartWorkflow(workflowId);
      const baseUrl = process.env.TALENTOS_BASE_URL || 'https://talent.skarion.com';
      await backgroundDispatch(
        fetch(`${baseUrl}/api/application-ai-workflows/dispatch`, {
          method: 'POST'
        }).catch((err) => {
          console.error(`[Workflow ${workflowId}] Restart dispatch fetch failed:`, err);
        })
      );
      return NextResponse.json({ workflowId, status: "queued", fromStage: 0 });
    }

    case "rerun": {
      const stageStr = url.searchParams.get("stage");
      const stage = stageStr ? parseInt(stageStr, 10) : 0;
      if (isNaN(stage) || stage < 0) {
        return NextResponse.json({ error: "Invalid stage parameter" }, { status: 400 });
      }
      await rerunFromStage(workflowId, stage);
      const baseUrl = process.env.TALENTOS_BASE_URL || 'https://talent.skarion.com';
      await backgroundDispatch(
        fetch(`${baseUrl}/api/application-ai-workflows/dispatch`, {
          method: 'POST'
        }).catch((err) => {
          console.error(`[Workflow ${workflowId}] Rerun dispatch fetch failed:`, err);
        })
      );
      return NextResponse.json({ workflowId, status: "queued", fromStage: stage });
    }

    case "move": {
      // Manual override — drag-and-drop a card to a different Kanban column.
      // Updates current_stage and adjusts status. Optionally re-dispatches
      // if the user dragged forward past the current stage (re-runs from
      // the new stage). If dragged to "completed", marks done without AI.
      const body = await req.json().catch(() => ({}));
      const targetStage = typeof body.stage === "number" ? body.stage : null;
      if (targetStage === null || targetStage < 0 || targetStage > 5) {
        return NextResponse.json({ error: "stage must be an integer 0-5" }, { status: 400 });
      }

      const isCompleted = targetStage === 5;

      const updates: Record<string, unknown> = {
        current_stage: targetStage,
        last_error: null,
      };
      if (isCompleted) {
        updates.status = "completed";
        updates.completed_at = new Date().toISOString();
      } else {
        updates.status = "waiting";
      }

      await updateWorkflowStatus(workflowId, isCompleted ? "completed" : "waiting", updates);
      if (isCompleted) {
        await advanceAeStageAfterAiCompletion(
          wf.application_id,
          context.profile.display_name || context.profile.email || "Manual (Kanban)"
        );
      }
      return NextResponse.json({ workflowId, current_stage: targetStage, status: isCompleted ? "completed" : "waiting" });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
