import { NextRequest, NextResponse } from "next/server";
import { detectJobEligibilityRestrictions } from "@/lib/jobEligibilityRestrictions";
import { applicationAutomation } from "@/lib/applicationAutomation";
import { checkIdempotencyKey, checkRequiredHeaders, authenticateExtension, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";
import { createApplications } from "@/server/repositories/applicationsRepository";
import { createJob } from "@/server/repositories/jobsRepository";
import { query, queryOne, execute } from "@/server/db/neon";
import { backgroundDispatch } from "@/server/lib/waitUntil";
import { triggerAiWorkflowForApplication } from "@/server/services/applicationAiWorkflowService";
import { getSourceOfTruth, parseSourceOfTruth } from "@/server/services/sourceOfTruthService";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { getExtensionCandidateResumeOptions, listExtensionCandidates, validateExtensionResumeMatch } from "@/server/services/extensionJobMatchService";
import { recordExtensionActivity } from "@/server/services/extensionActivityService";

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
  const job = await queryOne<{ id: string }>(
    "SELECT id FROM jobs WHERE id = $1 AND COALESCE(is_active, true) = true", [jobId],
  );
  if (!job) return extensionError("job_not_found", "The selected job is missing or inactive.", 404);

  try {
    const candidateId = request.nextUrl.searchParams.get("candidateId") || "";
    if (candidateId) {
      if (!UUID_RE.test(candidateId)) return extensionError("validation_error", "A valid candidateId is required.", 400);
      const candidate = await getExtensionCandidateResumeOptions(jobId, candidateId);
      return NextResponse.json({ candidate });
    }

    const [candidates, owners] = await Promise.all([
      listExtensionCandidates(jobId),
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
    const job = await queryOne<{
      id: string; title: string; description_text: string | null; raw_description: string | null;
      eligibility_restricted: boolean | null; requires_citizenship: boolean | null;
      citizenship_countries: string[] | null; export_control_restricted: boolean | null;
      eligibility_restriction_evidence: string | null;
    }>(
      `SELECT id, title, description_text, raw_description, eligibility_restricted,
              requires_citizenship, citizenship_countries, export_control_restricted,
              eligibility_restriction_evidence
         FROM jobs WHERE id = $1 AND COALESCE(is_active, true) = true`, [body.jobId],
    );
    if (!job) return extensionError("job_not_found", "The selected job is missing or inactive.", 404);
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
    const automated = applicationAutomation({
      status: assignmentStatus,
      explicitFollowUp: false,
      explicitNextAction: false,
      // The extension sends the date field like TalentOS's job assignment
      // form, so an empty date remains an explicit "no due date" choice.
      explicitAssignmentDue: true,
    });

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
        const existing = await queryOne<{ id: string; candidate_name: string | null }>(
          `SELECT a.id, c.name AS candidate_name
             FROM applications a
             LEFT JOIN candidates c ON c.id = a.candidate_id
            WHERE a.job_id = $1 AND a.candidate_id = $2
            LIMIT 1`,
          [job.id, selection.candidateId],
        );
        if (existing) {
          results.push({
            candidateId: selection.candidateId,
            candidateName: existing.candidate_name,
            applicationId: existing.id,
            status: "already_logged",
            message: "This candidate is already logged to this job. No duplicate application was created.",
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
        const [application] = await createApplications([{
          candidate_id: selection.candidateId,
          job_id: job.id,
          // Keep the application status semantics used by the existing
          // matcher, then set the canonical AE stage below. createApplications
          // maps "assigned" to ready_for_review for legacy callers, so the
          // explicit stage update is required before the ticket is visible.
          status: assignmentStatus,
          source_type: "base_resume",
          base_resume_id: resume.baseResumeId,
          assigned_by_user_id: auth.key.owner_user_id,
          assigned_by: keyOwner.display_name || keyOwner.email || "Team member",
          assigned_to_user_id: applicationOwner.user_id,
          assigned_to: applicationOwner.display_name || applicationOwner.email || "Team member",
          // The database column is DATE; keep the date-only value used by the
          // TalentOS application form instead of serializing a timestamp.
          assignment_due_at: parsedDueDate ? dueDate : null,
          assignment_note: [
            assignmentNote,
            `Logged by TalentOS Job Capture. Base resume: ${resume.baseResumeName}. ${resumeScoreSummary}`,
          ].filter(Boolean).join("\n\n"),
          follow_up_at: automated.follow_up_at ?? null,
          next_action: automated.next_action ?? null,
          follow_up_source: automated.follow_up_source ?? null,
          follow_up_created_at: automated.follow_up_created_at ?? null,
          priority: "normal",
          review_status: "not_required",
          notes: `${resumeScoreSummary} ${resume.reason}`,
          created_by: auth.key.owner_user_id,
        }]);

        await execute(
          `UPDATE applications
              SET ae_stage = 'in_ai_pipeline', application_stage = 'in_ai_pipeline',
                  ae_stage_updated_at = NOW(), ae_stage_updated_by_user_id = $2,
          ae_stage_updated_by_name = $3, resume_generation_status = 'queued',
                  resume_generation_error = NULL
            WHERE id = $1`,
          [application.id, auth.key.owner_user_id, keyOwner.display_name || keyOwner.email || "Team member"],
        );

        await execute(
          `INSERT INTO application_events (application_id, from_status, to_status, note, created_by)
           VALUES ($1, NULL, $4, $2, $3)`,
          [application.id, `Logged through the team extension; base resume ${resume.baseResumeName}; ${resumeScoreSummary}`, auth.key.owner_user_id, assignmentStatus],
        ).catch((error) => console.error("[extension-job-workflow] Application event history write failed", error));
        await recordExtensionActivity({
          actorUserId: auth.key.owner_user_id,
          extensionKeyId: auth.key.id,
          eventType: "candidate_logged",
          jobId: job.id,
          applicationId: application.id,
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
          },
        }).catch((error) => console.error("[extension-job-workflow] Candidate activity tracking write failed", error));

        // Workflow creation performs database setup only; the existing TalentOS
        // dispatcher consumes the queued run and invokes the AI pipeline. Run
        // setup in waitUntil and expose an honest `starting` state immediately.
        const workflowSetup = triggerAiWorkflowForApplication(application.id, auth.key.owner_user_id, resume.baseResumeId)
          .then(async (result) => {
            if (result.started) {
              await execute(
                "UPDATE applications SET resume_generation_status = 'queued', resume_generation_error = NULL WHERE id = $1",
                [application.id],
              );
              return;
            }
            const reason = result.reason.slice(0, 1000);
            await execute(
              "UPDATE applications SET resume_generation_status = 'failed', resume_generation_error = $2 WHERE id = $1 AND resume_generation_status IN ('not_started', 'queued')",
              [application.id, reason],
            );
            console.warn(`[extension-job-workflow] Resume workflow did not start for ${application.id}: ${reason}`);
          })
          .catch(async (error) => {
            const reason = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
            await execute(
              "UPDATE applications SET resume_generation_status = 'failed', resume_generation_error = $2 WHERE id = $1 AND resume_generation_status IN ('not_started', 'queued')",
              [application.id, reason],
            ).catch((updateError) => console.error("[extension-job-workflow] Could not persist workflow setup failure", updateError));
            console.error(`[extension-job-workflow] Resume workflow setup failed for ${application.id}`, error);
          });
        backgroundDispatch(workflowSetup);
        // Match TalentOS's normal application-creation flow: parse Source of
        // Truth only if the candidate has never had it parsed. This avoids
        // duplicate AI usage for candidates with an existing audit while
        // keeping the resume pipeline's factual source current.
        const sourceOfTruthSetup = (async () => {
          const sourceOfTruth = await getSourceOfTruth(selection.candidateId);
          if (!sourceOfTruth || !sourceOfTruth.lastParsedAt) {
            await callWithUsageTracking(
              "candidate_source_of_truth",
              { userId: auth.key.owner_user_id!, applicationId: application.id },
              (provider) => parseSourceOfTruth(selection.candidateId, undefined, provider),
            );
          }
        })().catch((error) => console.error(`[extension-job-workflow] Source-of-Truth setup failed for ${application.id}`, error));
        backgroundDispatch(sourceOfTruthSetup);
        results.push({
          candidateId: selection.candidateId,
          candidateName: candidate.candidateName,
          applicationId: application.id,
          baseResumeId: resume.baseResumeId,
          baseResumeName: resume.baseResumeName,
          matchScore: hasApprovedMatchScore ? resume.score : null,
          resumeScoreType: resume.scoreType,
          localResumeRelevancePoints: resume.scoreType === "local_resume_relevance" ? resume.score : null,
          status: "logged",
          resumeWorkflow: "starting",
        });
      } catch (error) {
        results.push({ candidateId: selection.candidateId, status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    }

    return NextResponse.json({ jobId: job.id, results, completed: results.filter((x) => x.status === "logged").length, failed: results.filter((x) => x.status === "failed").length });
  }

  if (action !== "capture") return extensionError("validation_error", "action must be capture or assign.", 400);
  if (!body.title?.trim() || !body.applyUrl?.trim() || !body.jdText?.trim()) {
    return extensionError("validation_error", "title, applyUrl, and jdText are required.", 400);
  }
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
      company: body.company ?? null,
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
    const job = outcome.status === "duplicate" ? outcome.existing : outcome.job;
    await recordExtensionActivity({
      actorUserId: auth.key.owner_user_id,
      extensionKeyId: auth.key.id,
      eventType: outcome.status === "duplicate" ? "job_duplicate" : "job_added",
      jobId: job.id,
      idempotencyKey,
      metadata: { title: body.title, company: body.company ?? null, eligibilityAcknowledged: eligibility.eligibilityRestricted },
    });

    return NextResponse.json({
      jobId: job.id,
      duplicate: outcome.status === "duplicate",
      job: { title: job.title, company: job.company },
      eligibility,
      candidateMatching: body.matchCandidates
        ? { status: "ready", message: "Choose an active candidate to see scored base resumes and select an owner." }
        : undefined,
    }, { status: outcome.status === "duplicate" ? 200 : 201 });
  } catch (error) {
    return extensionError("internal_error", error instanceof Error ? error.message : String(error), 500);
  }
});
