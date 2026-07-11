// POST /api/applications/[id]/ai-workflow — start a multi-agent workflow
// GET /api/applications/[id]/ai-workflow — get workflow status
// Requires APPLICATION_WORKER_ROLES

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { startWorkflow, processWorkflowStage, cancelWorkflow } from "@/server/services/applicationAiWorkflowService";
import { findActiveWorkflowByApplicationId, findWorkflowById, listStageRuns, listArtifacts } from "@/server/repositories/applicationAiWorkflowRepository";
import { query, queryOne } from "@/server/db/neon";

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

  // Check for existing active workflow
  const existing = await findActiveWorkflowByApplicationId(applicationId);
  if (existing) {
    return NextResponse.json({
      error: "An active workflow already exists for this application",
      workflowId: existing.id,
      status: existing.status,
    }, { status: 409 });
  }

  // Derive candidate and job from the application
  const appRow = await queryOne<{ candidate_id: string; job_id: string | null }>(
    "SELECT candidate_id, job_id FROM applications WHERE id = $1",
    [applicationId]
  );
  if (!appRow) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  // Load job data
  let job: any = {};
  if (appRow.job_id) {
    const jobRow = await queryOne("SELECT * FROM jobs WHERE id = $1", [appRow.job_id]);
    if (jobRow) job = jobRow;
  }

  // Load candidate data
  let baseResume: any = {};
  const resumeRow = await queryOne(
    "SELECT * FROM application_resume_versions WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1",
    [applicationId]
  );
  if (resumeRow) baseResume = resumeRow;

  // Load evidence
  const evidence = await query(
    "SELECT * FROM candidate_evidence WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 50",
    [appRow.candidate_id]
  );

  const { workflowId } = await startWorkflow({
    applicationId,
    candidateId: appRow.candidate_id,
    job,
    baseResume,
    evidence: evidence ?? [],
    startedBy: context?.profile.user_id,
  });

  // Dispatch first stage asynchronously (don't await)
  processWorkflowStage(workflowId).catch((err) => {
    console.error(`[Workflow ${workflowId}] Stage processing failed:`, err);
  });

  return NextResponse.json({
    workflowId,
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


