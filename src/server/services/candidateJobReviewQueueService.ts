// Approve/reject/retry for candidate_job_review_queue - the shared human
// review gate for Scheduled Candidate Logging and the job-capture
// extension's "assign" action (migration 132). Modeled directly on
// approveCandidateJobMatch()/rejectCandidateJobMatch() in
// candidateJobMatcherService.ts: approval is the only thing that creates a
// real applications row and starts the AI resume pipeline, and re-approving
// an already-approved row is idempotent (re-triggers the AI step rather
// than erroring) instead of failing.

import { query, queryOne, execute } from "@/server/db/neon";
import { createApplications } from "@/server/repositories/applicationsRepository";
import { triggerAiWorkflowForApplication } from "@/server/services/applicationAiWorkflowService";
import { applicationAutomation } from "@/lib/applicationAutomation";
import { assessmentForHumanReview } from "@/lib/candidateReviewAssessment";
import { scoreStage2, type ScoringJob, type ScoringCandidate, type ScoringResume } from "@/server/services/candidateJobScoring";

export interface ReviewQueueRow {
  id: string;
  source: "scheduled_logging" | "extension";
  candidate_id: string;
  job_id: string;
  base_resume_id: string | null;
  alternate_resumes: { resumeId: string; resumeName: string | null; score: number }[];
  ats_score: number | null;
  ai_status: "pending" | "scored" | "failed";
  ai_tier: "strong" | "adjacent" | "stretch" | null;
  ai_score: number | null;
  ai_reason: string | null;
  ai_failure_reason: string | null;
  hard_gates: string[];
  status: "pending" | "approved" | "rejected";
  priority: "high" | "default" | "low";
  assigned_by_user_id: string | null;
  assigned_to_user_id: string | null;
  assignment_note: string | null;
  assignment_due_at: string | null;
  application_id: string | null;
}

async function requirePendingOrApproved(id: string): Promise<ReviewQueueRow> {
  const row = await queryOne<ReviewQueueRow>("SELECT * FROM candidate_job_review_queue WHERE id = $1", [id]);
  if (!row) throw new Error("Review item not found.");
  return row;
}

export async function approveReviewItem(id: string, actorUserId: string): Promise<{ applicationId: string }> {
  const row = await requirePendingOrApproved(id);
  if (row.status === "rejected") throw new Error("This item was already rejected. Nothing to approve.");

  // Idempotent re-approve: if a prior approval already created the
  // application (e.g. the AI-trigger step failed and someone retried),
  // just re-trigger the AI workflow instead of erroring or duplicating.
  if (row.status === "approved" && row.application_id) {
    await triggerAiWorkflowForApplication(row.application_id, actorUserId, row.base_resume_id ?? undefined).catch(async (error) => {
      await execute(
        "UPDATE applications SET resume_generation_status = 'failed', resume_generation_error = $2 WHERE id = $1 AND resume_generation_status <> 'complete'",
        [row.application_id, (error instanceof Error ? error.message : String(error)).slice(0, 1000)],
      );
    });
    return { applicationId: row.application_id };
  }

  if (!row.base_resume_id) throw new Error("No base resume is attached to this item; pick a resume before approving.");

  // Re-validate - the pair may have stopped being eligible since it was
  // queued (job went inactive, candidate dropped, or someone else already
  // applied this candidate/another one to this job in the meantime).
  const [job, candidate, existingApplication] = await Promise.all([
    queryOne<{ is_active: boolean }>("SELECT is_active FROM jobs WHERE id = $1", [row.job_id]),
    queryOne<{ status: string; pipeline_stage: string | null }>("SELECT status, pipeline_stage FROM candidates WHERE id = $1", [row.candidate_id]),
    // Global dedup, same rule as queueing: a job already applied to by
    // anyone blocks approval here too.
    queryOne<{ id: string }>("SELECT id FROM applications WHERE job_id = $1 LIMIT 1", [row.job_id]),
  ]);
  if (!job) throw new Error("This job no longer exists.");
  if (!job.is_active) throw new Error("This job is no longer active.");
  if (!candidate || candidate.status !== "active") throw new Error("This candidate is no longer active.");
  if (existingApplication) throw new Error("Another candidate has already been applied to this job since it was queued.");

  // Same automatic follow-up/due-date scheduling the extension's direct-
  // assign flow used to apply at creation time - now applied here, at
  // approval, since that's when the application actually comes into being.
  const automated = applicationAutomation({
    status: "assigned", explicitFollowUp: false, explicitNextAction: false,
    explicitAssignmentDue: row.assignment_due_at != null,
  });
  const [created] = await createApplications([{
    candidate_id: row.candidate_id,
    job_id: row.job_id,
    status: "assigned",
    source_type: "base_resume",
    base_resume_id: row.base_resume_id,
    assigned_by_user_id: row.assigned_by_user_id,
    assigned_to_user_id: row.assigned_to_user_id,
    assignment_note: row.assignment_note ?? (row.source === "extension" ? "Logged through the team extension; approved via Review Queue." : "Scheduled candidate-job match; approved via Review Queue."),
    assignment_due_at: row.assignment_due_at ?? automated.assignment_due_at ?? null,
    follow_up_at: automated.follow_up_at ?? null,
    next_action: automated.next_action ?? null,
    follow_up_source: automated.follow_up_source ?? null,
    follow_up_created_at: automated.follow_up_created_at ?? null,
    priority: row.priority === "high" ? "urgent" : row.priority === "low" ? "low" : "normal",
    review_status: "not_required",
    notes: row.ai_reason ?? (row.ats_score != null ? `Keyword/ATS score ${row.ats_score}/100.` : null),
    created_by: actorUserId,
  }]);

  // createApplications maps status "assigned" to ae_stage "ready_for_review"
  // by default; this feature always wants the AI pipeline to start on
  // approval, so force it forward explicitly (same two-step pattern the
  // extension's own direct-assign flow already used).
  await execute(
    `UPDATE applications SET ae_stage = 'in_ai_pipeline', application_stage = 'in_ai_pipeline',
        ae_stage_updated_at = NOW(), ae_stage_updated_by_user_id = $2,
        resume_generation_status = 'queued', resume_generation_error = NULL
      WHERE id = $1`,
    [created.id, actorUserId],
  );
  await execute(
    `INSERT INTO application_events (application_id, from_status, to_status, note, created_by)
     VALUES ($1, NULL, 'assigned', $2, $3)`,
    [created.id, `Approved from the Review Queue (${row.source === "extension" ? "extension" : "scheduled logging"}).`, actorUserId],
  ).catch((error) => console.error("[candidateJobReviewQueueService] Application event write failed", error));

  await execute(
    `UPDATE candidate_job_review_queue
        SET status = 'approved', application_id = $2, reviewed_by_user_id = $3, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [row.id, created.id, actorUserId],
  );

  await triggerAiWorkflowForApplication(created.id, actorUserId, row.base_resume_id).catch(async (error) => {
    await execute(
      "UPDATE applications SET resume_generation_status = 'failed', resume_generation_error = $2 WHERE id = $1 AND resume_generation_status <> 'complete'",
      [created.id, (error instanceof Error ? error.message : String(error)).slice(0, 1000)],
    );
  });

  return { applicationId: created.id };
}

export async function rejectReviewItem(id: string, actorUserId: string, note: string | null): Promise<void> {
  const row = await requirePendingOrApproved(id);
  if (row.status === "approved") throw new Error("This item was already approved and has a live application; it cannot be rejected from here.");
  await execute(
    `UPDATE candidate_job_review_queue
        SET status = 'rejected', reviewed_by_user_id = $2, reviewed_at = NOW(), review_note = $3, updated_at = NOW()
      WHERE id = $1`,
    [id, actorUserId, note?.slice(0, 2000) ?? null],
  );
}

export async function bulkApproveByTier(tiers: string[], actorUserId: string): Promise<{ approved: number; failed: { id: string; error: string }[] }> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM candidate_job_review_queue WHERE status = 'pending' AND ai_tier = ANY($1::text[]) ORDER BY created_at ASC`,
    [tiers],
  );
  let approved = 0;
  const failed: { id: string; error: string }[] = [];
  for (const row of rows) {
    try {
      await approveReviewItem(row.id, actorUserId);
      approved++;
    } catch (error) {
      failed.push({ id: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { approved, failed };
}

// Lets an admin/manager re-run just Stage 2 for one item that's sitting
// ai_status='failed' (or 'pending') - the AI-failure-resilience requirement:
// a pair is never stuck just because the shared pool had a bad moment.
export async function retryAiScoring(id: string, customPrompt: string, crossCheckFloor?: number): Promise<void> {
  const row = await requirePendingOrApproved(id);
  if (row.status !== "pending") throw new Error("Only a pending item can be re-scored.");
  if (!row.base_resume_id) throw new Error("No base resume is attached to this item.");

  const [job, candidate, resume] = await Promise.all([
    queryOne<any>(
      `SELECT id AS job_id, title, company, location, seniority_level, description_text, raw_description,
              requires_citizenship, citizenship_countries, export_control_restricted, eligibility_restriction_evidence
         FROM jobs WHERE id = $1`,
      [row.job_id],
    ),
    queryOne<any>(
      `SELECT c.id, c.name, c.work_authorization, c.visa_status, c.preferred_locations,
              COALESCE(r.priority, 'default') AS priority,
              COALESCE(r.preferences, '{}'::jsonb) AS preferences,
              COALESCE(r.custom_requirements, '') AS custom_requirements
         FROM candidates c LEFT JOIN scheduled_candidate_logging_candidate_rules r ON r.candidate_id = c.id
        WHERE c.id = $1`,
      [row.candidate_id],
    ),
    queryOne<ScoringResume>("SELECT id, candidate_id, name, target_industry, target_roles, content, status FROM base_resumes WHERE id = $1", [row.base_resume_id]),
  ]);
  if (!job || !candidate || !resume) throw new Error("Job, candidate, or resume for this item is no longer available.");

  const scoringJob: ScoringJob = {
    job_id: job.job_id, title: job.title, company: job.company, location: job.location,
    seniority_level: job.seniority_level, freshnessReferenceDate: null,
    requires_citizenship: job.requires_citizenship, citizenship_countries: job.citizenship_countries,
    export_control_restricted: job.export_control_restricted, eligibility_restriction_evidence: job.eligibility_restriction_evidence,
  };
  const scoringCandidate: ScoringCandidate = candidate;
  const description = String(job.description_text ?? job.raw_description ?? "").slice(0, 20_000);

  const outcome = await scoreStage2({
    customPrompt, job: scoringJob, candidate: scoringCandidate, resume,
    description, deterministicScore: row.ats_score ?? 0, crossCheckFloor, runId: null,
  });

  if (outcome.status === "failed") {
    await execute(
      `UPDATE candidate_job_review_queue SET ai_status = 'failed', ai_failure_reason = $2, updated_at = NOW() WHERE id = $1`,
      [id, outcome.failureReason],
    );
    throw new Error(outcome.failureReason);
  }
  const review = assessmentForHumanReview(outcome);
  await execute(
    `UPDATE candidate_job_review_queue
        SET ai_status = 'scored', ai_tier = $2, ai_score = $3, ai_reason = $4,
            hard_gates = $5::jsonb, ai_failure_reason = NULL, updated_at = NOW()
      WHERE id = $1`,
    [id, review.aiTier, outcome.score, review.aiReason, JSON.stringify([...new Set([...row.hard_gates, ...review.hardGates])])],
  );
}
