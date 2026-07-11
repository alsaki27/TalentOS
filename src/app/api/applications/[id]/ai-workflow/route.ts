import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { startWorkflow, dispatchWorkflowById } from "@/server/services/applicationAiWorkflowService";
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

  const existing = await findActiveWorkflowByApplicationId(applicationId);
  if (existing) {
    return NextResponse.json({
      error: "An active workflow already exists for this application",
      workflowId: existing.id,
      status: existing.status,
    }, { status: 409 });
  }

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

  // Load base resume for the specific application's candidate+job combo.
  // Prioritise the resume linked to the target_job for this application's job,
  // falling back to the candidate's most recent base resume overall.
  let baseResume: any = {};
  let resumeRow = null;
  if (appRow.job_id) {
    resumeRow = await queryOne(
      `SELECT arv.* FROM application_resume_versions arv
       WHERE arv.target_job_id IN (
         SELECT id FROM target_jobs WHERE candidate_id = $1 AND job_id = $2
       )
       AND arv.source_type = 'base_resume' AND arv.status = 'active'
       ORDER BY arv.created_at DESC LIMIT 1`,
      [appRow.candidate_id, appRow.job_id]
    );
  }
  if (!resumeRow) {
    resumeRow = await queryOne(
      "SELECT * FROM application_resume_versions WHERE candidate_id = $1 AND source_type = 'base_resume' ORDER BY created_at DESC LIMIT 1",
      [appRow.candidate_id]
    );
  }
  if (!resumeRow) {
    return NextResponse.json({
      error: "No base resume found. Please select or create a base resume for this candidate before generating.",
    }, { status: 400 });
  }
  baseResume = resumeRow;

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

  // Dispatch the first stage
  dispatchWorkflowById(workflowId).catch((err) => {
    console.error(`[Workflow ${workflowId}] Initial dispatch failed:`, err);
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
