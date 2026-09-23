import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { triggerAiWorkflowForApplication } from "@/server/services/applicationAiWorkflowService";
import { listStageRuns, listArtifacts, findActiveWorkflowByApplicationId } from "@/server/repositories/applicationAiWorkflowRepository";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = params.id;
  if (!applicationId) {
    return NextResponse.json({ error: "Application ID is required" }, { status: 400 });
  }

  let result;
  try {
    result = await triggerAiWorkflowForApplication(applicationId, context?.profile.user_id);
  } catch (err: any) {
    // Previously unguarded - any exception here (e.g. the base_resume_id FK
    // violation this surfaced) propagated as an empty-body 500 with zero
    // diagnostic trail.
    return NextResponse.json({ error: err.message ?? String(err) }, { status: 500 });
  }

  if (!result.started) {
    if (result.reason === "An active workflow already exists for this application") {
      const existing = await findActiveWorkflowByApplicationId(applicationId);
      return NextResponse.json({
        error: result.reason,
        workflowId: existing?.id,
        status: existing?.status,
      }, { status: 409 });
    }
    if (result.reason === "Application not found") {
      return NextResponse.json({ error: result.reason }, { status: 404 });
    }
    if (result.reason === "No base resume found for this candidate yet") {
      return NextResponse.json({
        error: "No base resume found. Please select or create a base resume for this candidate before generating.",
      }, { status: 400 });
    }
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({
    workflowId: result.workflowId,
    status: "queued",
    message: "Multi-agent workflow started",
  }, { status: 202 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const wf = await findActiveWorkflowByApplicationId(params.id);
  if (!wf) {
    return NextResponse.json({ workflow: null, message: "No active workflow" });
  }

  const stages = await listStageRuns(wf.id);
  const artifacts = await listArtifacts(wf.id);

  return NextResponse.json({
    workflow: {
      id: wf.id,
      status: wf.status,
      currentStage: wf.current_stage,
      lastError: wf.last_error,
      createdAt: wf.created_at,
      completedAt: wf.completed_at,
    },
    stages,
    artifacts,
  });
}
