// src/app/api/applications/[id]/transfer-candidate/route.ts
// POST -> move a job ticket from its current candidate to a different one.
//
// Deliberately does NOT update `applications.candidate_id` in place on the
// existing row. That row's tailored resume (application_resume_versions),
// AI workflow runs (application_ai_workflows/application_ai_artifacts), and
// workflow config snapshot all belong to the OLD candidate - silently
// repointing candidate_id would leave every one of those permanently
// mismatched against the new candidate (the old candidate's resume content,
// still attached, now labeled as the new candidate's). Instead: close the
// old application (same deleteApplication() path "Remove ticket" already
// uses) and create a brand new one for the new candidate against the same
// job, then start the AI pipeline on it from scratch - exactly the same
// path a manually created application goes through, so there is nothing
// carried over from the old candidate to be wrong about.
import { NextRequest, NextResponse } from "next/server";
import { ASSIGNMENT_MANAGER_ROLES, getCurrentUserContext, hasRole } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { triggerWebhooks } from "@/lib/webhookEngine";
import { queryOne, execute } from "@/server/db/neon";
import { findApplicationById, createApplications, deleteApplication } from "@/server/repositories/applicationsRepository";
import { triggerAiWorkflowForApplication } from "@/server/services/applicationAiWorkflowService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!hasRole(currentUser.profile, ASSIGNMENT_MANAGER_ROLES)) {
    return NextResponse.json({ error: "Only admins, managers, and recruiters can transfer applications between candidates." }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const newCandidateId = typeof body.candidateId === "string" ? body.candidateId.trim() : "";
  if (!newCandidateId) {
    return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
  }

  const oldApplication = await findApplicationById(params.id);
  if (!oldApplication) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }
  if (!oldApplication.job_id) {
    return NextResponse.json({ error: "This application has no job attached, so it cannot be transferred." }, { status: 400 });
  }
  if (oldApplication.candidate_id === newCandidateId) {
    return NextResponse.json({ error: "This application already belongs to that candidate." }, { status: 400 });
  }

  // Server-side re-validation - never trust a client-supplied candidate name,
  // same discipline the existing bulk owner-reassignment already applies to
  // assigned_to_user_id (src/app/api/bulk/route.ts).
  const newCandidate = await queryOne<{
    id: string; name: string; email: string | null; phone: string | null;
    resume_url: string | null; resume_filename: string | null;
    candidate_number: number | null; avatar_url: string | null; status: string | null;
  }>(
    `SELECT id, name, email, phone, resume_url, resume_filename, candidate_number, avatar_url, status
     FROM candidates WHERE id = $1`,
    [newCandidateId]
  );
  if (!newCandidate) {
    return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  }
  if (newCandidate.status && newCandidate.status !== "active") {
    return NextResponse.json({ error: `That candidate is not active (status: ${newCandidate.status}).` }, { status: 400 });
  }

  // applications has a unique (candidate_id, job_id) constraint - check first
  // for a clean, specific error instead of a raw database constraint failure.
  const duplicate = await queryOne<{ id: string }>(
    "SELECT id FROM applications WHERE candidate_id = $1 AND job_id = $2",
    [newCandidateId, oldApplication.job_id]
  );
  if (duplicate) {
    return NextResponse.json({ error: "That candidate already has an application logged for this job." }, { status: 409 });
  }

  let created;
  try {
    // status "in_ai_pipeline" deliberately isn't one of createApplications'
    // special-cased status values (applied/rejected/withdrawn/in_progress/
    // assigned/stacked), so it computes application_stage:"in_ai_pipeline" -
    // a fresh ticket, not carrying over the old ticket's stage. base_resume_id
    // is left unset on purpose: triggerAiWorkflowForApplication below runs
    // its own best-match base-resume selection for the new candidate.
    const rows = await createApplications([{
      candidate_id: newCandidateId,
      job_id: oldApplication.job_id,
      status: "in_ai_pipeline",
      source_type: "base_resume",
      assigned_by: oldApplication.assigned_by,
      assigned_to: oldApplication.assigned_to,
      assigned_by_user_id: oldApplication.assigned_by_user_id,
      assigned_to_user_id: oldApplication.assigned_to_user_id,
      priority: oldApplication.priority,
      notes: `Transferred from another candidate's ticket (${params.id}) by ${currentUser.profile.display_name || currentUser.profile.email} on ${new Date().toISOString()}.`,
      created_by: currentUser.profile.user_id,
    }]);
    created = rows[0];
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Could not create the new application." }, { status: 500 });
  }

  // The old ticket must disappear from the previous candidate immediately -
  // reuse the exact same deletion path "Remove ticket" already uses, so
  // cleanup behavior stays identical to every other delete in the app.
  try {
    await deleteApplication(params.id);
  } catch (error: any) {
    // The new application already exists - never leave this unreported.
    return NextResponse.json({
      error: `Created the new application but could not remove the old one: ${error.message || error}. Both tickets currently exist — remove the old one (${params.id}) manually.`,
      newApplicationId: created.id,
    }, { status: 500 });
  }

  // Start the AI pipeline fresh for the new candidate. No preferredBaseResumeId
  // is passed, so triggerAiWorkflowForApplication's own selectBestBaseResume
  // matching picks the right résumé "lane" for this candidate/job.
  const workflowResult = await triggerAiWorkflowForApplication(created.id, currentUser.profile.user_id);

  await execute(
    "INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      currentUser.profile.user_id,
      currentUser.profile.email,
      "application.transferred_candidate",
      "application",
      created.id,
      JSON.stringify({
        from_application_id: params.id,
        from_candidate_id: oldApplication.candidate_id,
        to_candidate_id: newCandidateId,
        job_id: oldApplication.job_id,
        workflow_started: workflowResult.started,
      }),
    ]
  );
  await logActivity({
    userId: currentUser.profile.user_id,
    actorName: currentUser.profile.display_name || currentUser.profile.email || undefined,
    type: "update",
    description: `Transferred a job application to ${newCandidate.name}`,
    entityType: "application",
    entityId: created.id,
    metadata: { from_application_id: params.id, from_candidate_id: oldApplication.candidate_id },
  });
  void triggerWebhooks("application.transferred_candidate", {
    old_application_id: params.id,
    new_application_id: created.id,
    new_candidate_id: newCandidateId,
  });

  return NextResponse.json({
    oldApplicationId: params.id,
    application: {
      id: created.id,
      candidates: {
        id: newCandidate.id,
        name: newCandidate.name,
        email: newCandidate.email,
        phone: newCandidate.phone,
        resume_url: newCandidate.resume_url,
        resume_filename: newCandidate.resume_filename,
        candidate_number: newCandidate.candidate_number,
        avatar_url: newCandidate.avatar_url,
      },
      status: created.status,
      ae_stage: created.ae_stage,
      workflowStarted: workflowResult.started,
      workflowReason: workflowResult.started ? null : workflowResult.reason,
    },
  }, { status: 200 });
}
