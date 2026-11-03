import { NextRequest, NextResponse } from "next/server";
import { detectJobEligibilityRestrictions } from "@/lib/jobEligibilityRestrictions";
import { assessmentForHumanReview } from "@/lib/candidateReviewAssessment";
import { checkIdempotencyKey, checkRequiredHeaders, authenticateExtension, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";
import { createJob } from "@/server/repositories/jobsRepository";
import { query, queryOne } from "@/server/db/neon";
import { getExtensionCandidateResumeOptions, listExtensionCandidates, validateExtensionResumeMatch } from "@/server/services/extensionJobMatchService";
import { recordExtensionActivity } from "@/server/services/extensionActivityService";
import { scoreStage1, scoreStage2, type ScoringCandidate, type ScoringJob, type ScoringResume } from "@/server/services/candidateJobScoring";

import { cleanCapturedCompany, resolveJobCaptureTarget } from "@/server/services/jobCaptureStatusService";

type CaptureBody = {
  action?: "capture" | "assign";
  title?: string;
  company?: string | null;
  location?: string | null;
  jdText?: string;
  applyUrl?: string;
  sourceUrl?: string | null;
  identityUrls?: string[];
  salary?: string | null;
  postedAt?: string | null;
  employmentType?: string | null;
  atsDetected?: string | null;
  screenshotUrl?: string | null;
  isRemote?: boolean;
  signals?: string[];
  externalId?: string | null;
  acknowledgeEligibility?: boolean;
  matchCandidates?: boolean;
  jobId?: string;
  selections?: Array<{ candidateId: string; baseResumeId: string }>;
  assignmentStatus?: "stacked" | "assigned" | "in_progress";
  assignedToUserId?: string;
  assignmentDueAt?: string | null;
  assignmentNote?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// The extension checks this contract before submitting. Older deployed
// endpoints created applications directly and must not be treated as gated.
const REVIEW_CONTRACT = { assignmentMode: "human_review", reviewQueueUrl: "/candidate-job-review" } as const;

export const GET = withExtensionCors(async (request) => {
  const headerError = checkRequiredHeaders(request);
  if (headerError) return headerError;

  const auth = await authenticateExtension(request, EXTENSION_SCOPES.applicationAssign);
  if (auth instanceof NextResponse) return auth;
  if (!auth.key.owner_user_id) {
    return extensionError("key_owner_required", "This workflow requires a team-member-owned key. Ask an admin to issue an assigned key.", 403);
  }

  const keyOwner = await queryOne<{ user_id: string; display_name: string | null; email: string | null }>(
    "SELECT user_id, display_name, email FROM profiles WHERE user_id = $1 AND is_active = true",
    [auth.key.owner_user_id],
  );
  if (!keyOwner) return extensionError("key_owner_inactive", "This key is no longer assigned to an active team member. Ask an admin to update it.", 403);

  const jobId = request.nextUrl.searchParams.get("jobId") || "";
  if (!UUID_RE.test(jobId)) return extensionError("validation_error", "A valid jobId is required.", 400);
  const { job, jobStatus } = await resolveJobCaptureTarget(jobId);
  if (!job) return extensionError("job_not_found", "This job record was not found in TalentOS.", 404);
  if (job.is_active === false) return extensionError("job_inactive", "This job is inactive in TalentOS. Its source posting availability has not been verified.", 409, jobStatus);

  try {
    const candidateId = request.nextUrl.searchParams.get("candidateId") || "";
    if (candidateId) {
      if (!UUID_RE.test(candidateId)) return extensionError("validation_error", "A valid candidateId is required.", 400);
      const candidate = await getExtensionCandidateResumeOptions(job.id, candidateId);
      return NextResponse.json({ candidate, jobId: job.id, jobStatus, ...REVIEW_CONTRACT });
    }

    const [candidates, owners] = await Promise.all([
      listExtensionCandidates(job.id),
      query<{ user_id: string; display_name: string | null; email: string; role: string }>(
        `SELECT user_id, display_name, email, role
           FROM profiles
          WHERE is_active = true
          ORDER BY CASE WHEN role = 'application_engineer' THEN 0 ELSE 1 END,
                   display_name NULLS LAST, email`,
      ),
    ]);
    return NextResponse.json({
      candidates,
      ...REVIEW_CONTRACT,
      jobId: job.id, jobStatus,
      owners: owners.map((owner) => ({ userId: owner.user_id, name: owner.display_name || owner.email, role: owner.role })),
      assignedBy: keyOwner.display_name || keyOwner.email || "Team member",
      defaultOwnerUserId: keyOwner.user_id,
    });
  } catch (error) {
    console.error("[extension-job-workflow] Candidate picker failed", error);
    return extensionError("internal_error", error instanceof Error ? error.message : "Could not load candidate options.", 500);
  }
});

export const POST = withExtensionCors(async (request) => {
  const headerError = checkRequiredHeaders(request);
  if (headerError) return headerError;
  const idempotencyError = checkIdempotencyKey(request);
  if (idempotencyError) return idempotencyError;

  const auth = await authenticateExtension(request, [EXTENSION_SCOPES.jobCapture, EXTENSION_SCOPES.applicationAssign]);
  if (auth instanceof NextResponse) return auth;
  if (!auth.key.owner_user_id) {
    return extensionError("key_owner_required", "This workflow requires a team-member-owned key. Ask an admin to issue an assigned key.", 403);
  }
  const keyOwner = await queryOne<{ user_id: string; display_name: string | null; email: string | null }>(
    `SELECT user_id, display_name, email FROM profiles
      WHERE user_id = $1 AND is_active = true`,
    [auth.key.owner_user_id],
  );
  if (!keyOwner) return extensionError("key_owner_inactive", "This key is no longer assigned to an active team member. Ask an admin to update it.", 403);

  let body: CaptureBody;
  try { body = await request.json(); }
  catch { return extensionError("validation_error", "Request body must be valid JSON.", 400); }
  const action = body.action ?? "capture";
  const idempotencyKey = request.headers.get("idempotency-key")!;

  if (action === "assign") {
    if (!body.jobId || !UUID_RE.test(body.jobId) || !Array.isArray(body.selections) || body.selections.length === 0 || body.selections.length > 20) {
      return extensionError("validation_error", "jobId and 1-20 candidate/resume selections are required.", 400);
    }
    const { job, jobStatus } = await resolveJobCaptureTarget(body.jobId);
    if (!job) return extensionError("job_not_found", "This job record was not found in TalentOS.", 404);
    if (job.is_active === false) return extensionError("job_inactive", "This job is inactive in TalentOS. Its source posting availability has not been verified.", 409, jobStatus);
    body.jobId = job.id;
    const detectedEligibility = detectJobEligibilityRestrictions([
      job.description_text, job.raw_description, job.eligibility_restriction_evidence,
    ].filter(Boolean).join("\n"));
    const eligibility = {
      ...detectedEligibility,
      eligibilityRestricted: detectedEligibility.eligibilityRestricted || job.eligibility_restricted === true
        || job.requires_citizenship === true || job.export_control_restricted === true,
      requiresCitizenship: detectedEligibility.requiresCitizenship || job.requires_citizenship === true,
      citizenshipCountries: detectedEligibility.citizenshipCountries ?? job.citizenship_countries ?? null,
      exportControlRestricted: detectedEligibility.exportControlRestricted || job.export_control_restricted === true,
      evidence: detectedEligibility.evidence ?? job.eligibility_restriction_evidence,
    };
    if (eligibility.eligibilityRestricted && body.acknowledgeEligibility !== true) {
      return NextResponse.json({ error: { code: "eligibility_ack_required", message: "Review the citizenship, clearance, or export-control restriction before logging candidates.", details: eligibility } }, { status: 409 });
    }

    const assignmentStatus = body.assignmentStatus ?? "assigned";
    if (!["stacked", "assigned", "in_progress"].includes(assignmentStatus)) {
      return extensionError("validation_error", "assignmentStatus must be stacked, assigned, or in_progress.", 400);
    }
    const assignedToUserId = body.assignedToUserId || auth.key.owner_user_id;
    if (!UUID_RE.test(assignedToUserId)) return extensionError("validation_error", "A valid application owner is required.", 400);
    const applicationOwner = await queryOne<{ user_id: string; display_name: string | null; email: string | null }>(
      "SELECT user_id, display_name, email FROM profiles WHERE user_id = $1 AND is_active = true",
      [assignedToUserId],
    );
    if (!applicationOwner) return extensionError("validation_error", "The selected application owner is no longer active.", 400);

    const dueDate = typeof body.assignmentDueAt === "string" ? body.assignmentDueAt.trim() : "";
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return extensionError("validation_error", "assignmentDueAt must be an ISO date (YYYY-MM-DD).", 400);
    }
    const parsedDueDate = dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null;
    if (parsedDueDate && (Number.isNaN(parsedDueDate.getTime()) || parsedDueDate.toISOString().slice(0, 10) !== dueDate)) {
      return extensionError("validation_error", "assignmentDueAt must be a real calendar date.", 400);
    }
    const assignmentNote = typeof body.assignmentNote === "string" ? body.assignmentNote.trim() : "";
    if (assignmentNote.length > 2000) return extensionError("validation_error", "Assignment note must be 2,000 characters or fewer.", 400);
    // applicationAutomation()'s follow_up_at/next_action/assignment_due_at
    // computation now happens at approval time, in
    // candidateJobReviewQueueService.ts's approveReviewItem() - that's when
    // the application actually comes into being, not when this pair is
    // queued for review.

    const results: Array<Record<string, unknown>> = [];
    const seenCandidates = new Set<string>();
    for (const selection of body.selections) {
      if (!selection?.candidateId || !selection?.baseResumeId
        || !UUID_RE.test(selection.candidateId) || !UUID_RE.test(selection.baseResumeId)
        || seenCandidates.has(selection.candidateId)) {
        results.push({ candidateId: selection?.candidateId ?? null, status: "failed", error: "Each candidate must appear once with a selected base resume." });
        continue;
      }
      seenCandidates.add(selection.candidateId);
      try {
        // Global dedup ("a job is excluded for everyone the moment anyone
        // has applied to it"): check both a real application and an
        // already-pending/approved review-queue row for this job, not just
        // this specific candidate - the capture/pick/log steps stay exactly
        // as they are for the operator; what happens after they click is
        // what changed.
        const [existingApplication, existingQueueItem] = await Promise.all([
          queryOne<{ id: string; candidate_name: string | null }>(
            `SELECT a.id, c.name AS candidate_name FROM applications a LEFT JOIN candidates c ON c.id = a.candidate_id
              WHERE a.job_id = $1 LIMIT 1`,
            [job.id],
          ),
          queryOne<{ id: string }>(
            `SELECT id FROM candidate_job_review_queue WHERE job_id = $1 AND status IN ('pending','approved') LIMIT 1`,
            [job.id],
          ),
        ]);
        if (existingApplication) {
          results.push({
            candidateId: selection.candidateId,
            candidateName: existingApplication.candidate_name,
            applicationId: existingApplication.id,
            status: "already_logged",
            message: "This job already has an application (for this or another candidate). No duplicate was created.",
          });
          continue;
        }
        if (existingQueueItem) {
          results.push({
            candidateId: selection.candidateId,
            reviewQueueId: existingQueueItem.id,
            status: "already_pending_review",
            message: "This job already has a pending or approved review-queue item for this or another candidate.",
          });
          continue;
        }

        const { candidate, resume } = await validateExtensionResumeMatch(job.id, selection.candidateId, selection.baseResumeId);
        const hasApprovedMatchScore = resume.scoreType === "approved_profile" && resume.score !== null;
        const resumeScoreSummary = hasApprovedMatchScore
          ? `TalentOS match ${resume.score}/100${resume.tier ? ` (Tier ${resume.tier})` : " (review below recommendation threshold)"}.`
          : resume.scoreType === "local_resume_relevance"
            ? `Local resume relevance estimate: ${resume.score ?? 0} points; this is not an approved match score.`
            : "No approved profile score was available.";

        // The capture/pick-candidate/pick-resume/click-to-log steps stay
        // exactly as they were - the only change is that this pair now goes
        // through the same ATS/AI scoring Scheduled Logging uses, then
        // waits for admin/manager approval instead of going straight to the
        // pipeline. An operator already chose this pair, so - unlike
        // Scheduled Logging's own automated pairs - nothing here is ever
        // silently excluded by a low score, a hard gate, or an AI "reject"
        // tier; it always reaches the queue, annotated with whatever
        // scoring info is available, for the reviewer to weigh.
        const [fullCandidate, fullResume] = await Promise.all([
          queryOne<any>(
            `SELECT c.id, c.name, c.work_authorization, c.visa_status, c.preferred_locations,
                    COALESCE(r.priority, 'default') AS priority,
                    COALESCE(r.preferences, '{}'::jsonb) AS preferences,
                    COALESCE(r.custom_requirements, '') AS custom_requirements
               FROM candidates c LEFT JOIN scheduled_candidate_logging_candidate_rules r ON r.candidate_id = c.id
              WHERE c.id = $1`,
            [selection.candidateId],
          ),
          queryOne<ScoringResume>(
            "SELECT id, candidate_id, name, target_industry, target_roles, content, status FROM base_resumes WHERE id = $1",
            [resume.baseResumeId],
          ),
        ]);
        const scoringCandidate: ScoringCandidate = fullCandidate;
        const scoringJob: ScoringJob = {
          job_id: job.id, title: job.title, company: job.company, location: job.location,
          seniority_level: job.seniority_level ?? null, freshnessReferenceDate: job.posted_at ?? job.created_at ?? null,
          requires_citizenship: eligibility.requiresCitizenship, citizenship_countries: eligibility.citizenshipCountries,
          export_control_restricted: eligibility.exportControlRestricted, eligibility_restriction_evidence: eligibility.evidence,
        };
        const description = String(job.description_text ?? job.raw_description ?? "").slice(0, 20_000);

        let atsScore: number | null = null;
        let hardGates: string[] = [];
        let aiStatus: "scored" | "failed" = "failed";
        let aiTier: string | null = null;
        let aiRecommendation: string | null = null;
        let aiScore: number | null = null;
        let aiReason: string | null = null;
        let aiFailureReason: string | null = null;
        if (fullCandidate && fullResume) {
          const stage1 = scoreStage1(scoringCandidate, [fullResume], description, scoringJob, 365);
          atsScore = stage1.bestScore;
          hardGates = stage1.hardGates;
          if (description.length >= 250) {
            const stage2Config = await queryOne<{ custom_prompt: string; ai_match_threshold: number }>("SELECT custom_prompt, ai_match_threshold FROM scheduled_candidate_logging_config WHERE id = true");
            const stage2 = await scoreStage2({
              customPrompt: stage2Config?.custom_prompt ?? "", job: scoringJob, candidate: scoringCandidate,
              resume: fullResume, description, deterministicScore: atsScore, crossCheckFloor: stage2Config?.ai_match_threshold, runId: null,
            });
            if (stage2.status === "scored") {
              const review = assessmentForHumanReview(stage2);
              aiStatus = "scored"; aiTier = review.aiTier; aiScore = stage2.score; aiReason = review.aiReason;
              aiRecommendation = stage2.tier;
              hardGates = [...hardGates, ...review.hardGates];
            } else {
              aiFailureReason = stage2.failureReason;
            }
          } else {
            aiFailureReason = "Job description too short to run the AI eligibility check; ATS score only.";
          }
        } else {
          aiFailureReason = "Candidate or resume record could not be loaded for scoring; queued with no score.";
        }

        const queueRow = await queryOne<{ id: string }>(
          `INSERT INTO candidate_job_review_queue
             (source, candidate_id, job_id, base_resume_id, alternate_resumes, ats_score,
              ai_status, ai_tier, ai_score, ai_reason, ai_failure_reason, hard_gates,
              priority, assigned_by_user_id, assigned_to_user_id, assignment_note, assignment_due_at, status)
           VALUES ('extension', $1, $2, $3, '[]'::jsonb, $4, $5, $6, $7, $8, $9, $10::jsonb, 'default', $11, $12, $13, $14, 'pending')
           ON CONFLICT (candidate_id, job_id) DO NOTHING
           RETURNING id`,
          [selection.candidateId, job.id, resume.baseResumeId, atsScore, aiStatus, aiTier, aiScore, aiReason, aiFailureReason,
            JSON.stringify(hardGates), auth.key.owner_user_id, applicationOwner.user_id,
            [assignmentNote, `Logged by TalentOS Job Capture. Base resume: ${resume.baseResumeName}. ${resumeScoreSummary}`].filter(Boolean).join("\n\n"),
            parsedDueDate ? dueDate : null],
        );
        if (!queueRow) {
          results.push({ candidateId: selection.candidateId, status: "already_pending_review", message: "This candidate already has a pending or resolved review item for this job." });
          continue;
        }

        await recordExtensionActivity({
          actorUserId: auth.key.owner_user_id,
          extensionKeyId: auth.key.id,
          eventType: "candidate_logged",
          jobId: job.id,
          candidateId: selection.candidateId,
          baseResumeId: resume.baseResumeId,
          matchScore: hasApprovedMatchScore ? resume.score : null,
          idempotencyKey: `${idempotencyKey}:${selection.candidateId}`,
          metadata: {
            candidateName: candidate.candidateName,
            baseResumeName: resume.baseResumeName,
            eligibilityAcknowledged: eligibility.eligibilityRestricted,
            assignmentStatus,
            assignedToUserId: applicationOwner.user_id,
            assignmentDueAt: dueDate || null,
            assignmentNote: assignmentNote || null,
            profileStatus: resume.profileStatus,
            scoreType: resume.scoreType,
            localResumeRelevancePoints: resume.scoreType === "local_resume_relevance" ? resume.score : null,
            recommended: resume.recommended,
            reviewQueueId: queueRow.id,
            atsScore, aiStatus, aiTier, aiRecommendation,
          },
        }).catch((error) => console.error("[extension-job-workflow] Candidate activity tracking write failed", error));

        results.push({
          candidateId: selection.candidateId,
          candidateName: candidate.candidateName,
          reviewQueueId: queueRow.id,
          baseResumeId: resume.baseResumeId,
          baseResumeName: resume.baseResumeName,
          atsScore, aiStatus, aiTier, aiScore, aiRecommendation,
          status: "submitted_for_review",
          applicationCreated: false,
          workflowStarted: false,
        });
      } catch (error) {
        results.push({ candidateId: selection.candidateId, status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    }

    return NextResponse.json({ ...REVIEW_CONTRACT, jobId: job.id, results, completed: results.filter((x) => x.status === "submitted_for_review").length, failed: results.filter((x) => x.status === "failed").length });
  }

  if (action !== "capture") return extensionError("validation_error", "action must be capture or assign.", 400);
  if (!body.title?.trim() || !body.applyUrl?.trim() || !body.jdText?.trim()) {
    return extensionError("validation_error", "title, applyUrl, and jdText are required.", 400);
  }
  const company = cleanCapturedCompany(body.company, body.sourceUrl || body.applyUrl, body.signals);
  if (body.company?.trim() && !company) return extensionError("invalid_employer", "Review the employer name. A navigation label or job board name cannot be saved as the company.", 422);
  const eligibility = detectJobEligibilityRestrictions(body.jdText);
  if (eligibility.eligibilityRestricted && body.acknowledgeEligibility !== true) {
    return NextResponse.json({ error: { code: "eligibility_ack_required", message: "This posting contains citizenship, clearance, or export-control restrictions. Review and confirm before adding it or logging candidates.", details: eligibility } }, { status: 409 });
  }

  const notes = [
    body.atsDetected && body.atsDetected !== "Unknown" ? `ATS: ${body.atsDetected}` : "",
    body.screenshotUrl ? `Screenshot: ${body.screenshotUrl}` : "",
  ].filter(Boolean).join("\n");
  try {
    const outcome = await createJob({
      title: body.title.trim(),
      company,
      location: body.location ?? null,
      description_text: body.jdText,
      apply_url: body.applyUrl.trim(),
      source_url: body.sourceUrl?.trim() || null,
      source: "extension",
      salary_range: body.salary ?? null,
      employment_type: body.employmentType ?? null,
      posted_at: body.postedAt?.trim() || null,
      external_job_id: body.externalId?.trim() || null,
      notes: notes || null,
    }, {
      identityUrls: Array.isArray(body.identityUrls) ? body.identityUrls.filter((x): x is string => typeof x === "string") : [],
      signals: Array.isArray(body.signals) ? body.signals.filter((x): x is string => typeof x === "string") : null,
      isRemote: typeof body.isRemote === "boolean" ? body.isRemote : null,
    });
    const captured = outcome.status === "duplicate" ? outcome.existing : outcome.job;
    const { job: resolved, jobStatus } = await resolveJobCaptureTarget(captured.id);
    const job = resolved ?? captured;
    const duplicate = outcome.status === "duplicate" || jobStatus.redirected;

    await recordExtensionActivity({
      actorUserId: auth.key.owner_user_id,
      extensionKeyId: auth.key.id,
      eventType: duplicate ? "job_duplicate" : "job_added",
      jobId: job.id,
      idempotencyKey,
      metadata: { title: body.title, company: body.company ?? null, eligibilityAcknowledged: eligibility.eligibilityRestricted },
    });

    return NextResponse.json({
      jobId: job.id,
      duplicate,
      jobStatus,
      job: { title: job.title, company: job.company },
      eligibility,
      candidateMatching: body.matchCandidates
        ? { status: "ready", message: "Choose an active candidate to see scored base resumes and select an owner." }
        : undefined,
    }, { status: duplicate ? 200 : 201 });
  } catch (error) {
    return extensionError("internal_error", error instanceof Error ? error.message : String(error), 500);
  }
});

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}
