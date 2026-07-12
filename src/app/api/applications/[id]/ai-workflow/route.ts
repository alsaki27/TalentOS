import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { startWorkflow, dispatchWorkflowById } from "@/server/services/applicationAiWorkflowService";
import { findActiveWorkflowByApplicationId, findWorkflowById, listStageRuns, listArtifacts } from "@/server/repositories/applicationAiWorkflowRepository";
import { upsertTargetJobByCandidateAndJob } from "@/server/repositories/targetJobsRepository";
import { query, queryOne, execute } from "@/server/db/neon";
import { backgroundDispatch } from "@/server/lib/waitUntil";

export const dynamic = "force-dynamic";

function jobDescriptionForTargetJob(job: any): string {
  return [
    `Title: ${job.title ?? ""}`,
    job.company ? `Company: ${job.company}` : null,
    job.location ? `Location: ${job.location}` : null,
    job.job_category ? `Category: ${job.job_category}` : null,
    job.description_text ? job.description_text : null,
    job.notes ? `Internal notes: ${job.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * A ticket created with "Resume Source: Base Resume" only materializes an
 * application_resume_versions row if the user separately clicks "Build with
 * Falood AI" right after creation (POST /api/quick-application/falood-setup).
 * Skip that and Generate 400s with "No base resume found" even though the
 * candidate has one. Replicates falood-setup's copy-from-base-resume step so
 * Generate works directly off a candidate's base resume, matching what the
 * ticket-creation UI already implied by letting you pick one as the source.
 */
async function materializeFromBaseResume(
  candidateId: string,
  jobId: string,
  applicationId: string,
  job: any,
  createdBy: string | undefined,
): Promise<any | null> {
  const baseResumeRow = await queryOne<{ id: string; content: unknown }>(
    "SELECT id, content FROM base_resumes WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 1",
    [candidateId]
  );
  if (!baseResumeRow) return null;

  const targetJob = await upsertTargetJobByCandidateAndJob(candidateId, jobId, {
    raw_description: jobDescriptionForTargetJob(job),
    created_by: createdBy,
  });
  if (!targetJob) return null;

  const version = await queryOne(
    `INSERT INTO application_resume_versions
       (candidate_id, base_resume_id, target_job_id, content, status, source_type, created_by, source_resume_id)
     VALUES ($1, $2, $3, $4::jsonb, 'active', 'base_resume', $5, $2)
     RETURNING *`,
    [candidateId, baseResumeRow.id, targetJob.id, JSON.stringify(baseResumeRow.content ?? {}), createdBy ?? null]
  );
  if (!version) return null;

  await execute(
    `INSERT INTO application_packets (application_id, resume_version_id, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (application_id) DO UPDATE SET resume_version_id = EXCLUDED.resume_version_id, updated_at = NOW()`,
    [applicationId, version.id]
  );

  return version;
}

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
  if (!resumeRow && appRow.job_id) {
    resumeRow = await materializeFromBaseResume(
      appRow.candidate_id,
      appRow.job_id,
      applicationId,
      job,
      context?.profile.user_id,
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
  // Fire-and-forget: respond 202 immediately so the UI isn't blocked;
  // stage processing runs asynchronously via the background dispatcher.
  // Registered with the Workers execution context (backgroundDispatch) so
  // it survives past this response instead of racing it.
  backgroundDispatch(
    dispatchWorkflowById(workflowId).catch((err) => {
      console.error(`[Workflow ${workflowId}] Initial dispatch failed:`, err);
    })
  );

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
