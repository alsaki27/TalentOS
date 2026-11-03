import { randomUUID } from "crypto";
import { isSafeExternalUrl, fetchJobPageText } from "@/lib/ai/job-agents/fetchJobPage";
import { query, queryOne, execute } from "@/server/db/neon";
import type { AiProvider as DbAiProvider } from "@/server/repositories/aiKeyRepository";
import {
  scoreStage1, scoreStage2, SCHEDULED_LOGGING_AUTOMATION_ID,
  type CandidatePriority, type ScoringCandidate, type ScoringResume, type ScoringJob,
} from "@/server/services/candidateJobScoring";

// Re-exported for existing test coverage and any other callers that still
// import these from here rather than the shared scoring module directly.
export { provesCitizenshipOf, checkStructuredEligibility, parseEligibilityResponse } from "@/server/services/candidateJobScoring";

type RunTrigger = "scheduled" | "manual" | "preview";

interface LoggingConfig {
  is_enabled: boolean;
  ai_provider: DbAiProvider | null;
  ai_model: string | null;
  ai_base_url: string | null;
  ai_encrypted_api_key: string | null;
  // Stage-1 noise floor (0-100, default 30) - not a fit-quality pass bar.
  // See migration 132.
  match_threshold: number;
  ai_match_threshold: number;
  jobs_per_run: number;
  ai_calls_per_run: number;
  // Max items queued for human review per run (migration 132 repurposed
  // this from "max applications created" now that approval, not this
  // service, creates applications).
  max_applications_per_run: number;
  job_freshness_days: number;
  custom_prompt: string;
  include_inactive_candidates: boolean;
  assigned_by_user_id: string | null;
  application_owner_user_id: string | null;
}

interface CandidateRow extends ScoringCandidate {
  status: string;
  pipeline_stage: string | null;
}

interface ResumeRow extends ScoringResume {}

interface IngestedJob {
  event_id: string;
  job_id: string;
  source: string;
  ingested_at: string;
  title: string;
  company: string | null;
  location: string | null;
  source_url: string | null;
  apply_url: string | null;
  description_text: string | null;
  raw_description: string | null;
  posted_at: string | null;
  seniority_level: string | null;
  job_category: string | null;
  is_active: boolean;
  requires_citizenship: boolean;
  citizenship_countries: string[] | null;
  export_control_restricted: boolean;
  eligibility_restriction_evidence: string | null;
}

async function saveDecision(input: {
  runId: string; job: IngestedJob; candidateId: string; resumeId?: string | null;
  deterministicScore?: number | null; score?: number | null; priority: CandidatePriority;
  status: string; reason: string; provider?: string | null; model?: string | null;
  inputTokens?: number; outputTokens?: number;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO scheduled_candidate_logging_decisions
       (run_id, ingestion_event_id, job_id, candidate_id, base_resume_id,
        deterministic_score, match_score, priority, status, reason, provider, model, input_tokens, output_tokens)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (ingestion_event_id, candidate_id) DO UPDATE SET
       run_id = EXCLUDED.run_id, base_resume_id = EXCLUDED.base_resume_id,
       deterministic_score = EXCLUDED.deterministic_score, match_score = EXCLUDED.match_score,
       priority = EXCLUDED.priority, status = EXCLUDED.status, reason = EXCLUDED.reason,
       provider = EXCLUDED.provider, model = EXCLUDED.model,
       input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens,
       updated_at = NOW()
     RETURNING id`,
    [input.runId, input.job.event_id, input.job.job_id, input.candidateId, input.resumeId ?? null,
      input.deterministicScore ?? null, input.score ?? null, input.priority, input.status,
      input.reason.slice(0, 2000), input.provider ?? null, input.model ?? null,
      input.inputTokens ?? 0, input.outputTokens ?? 0],
  );
  if (!row) throw new Error("Could not save scheduled-logging decision.");
  return row.id;
}

async function queueForReview(input: {
  candidateId: string; jobId: string; baseResumeId: string;
  alternateResumes: { resumeId: string; resumeName: string | null; score: number }[];
  atsScore: number; aiStatus: "scored" | "failed"; aiTier: string | null; aiScore: number | null;
  aiReason: string | null; aiFailureReason: string | null; hardGates: string[];
  priority: CandidatePriority; assignedBy: string; assignedTo: string; sourceDecisionId: string;
}) {
  await execute(
    `INSERT INTO candidate_job_review_queue
       (source, candidate_id, job_id, base_resume_id, alternate_resumes, ats_score,
        ai_status, ai_tier, ai_score, ai_reason, ai_failure_reason, hard_gates,
        priority, assigned_by_user_id, assigned_to_user_id, source_decision_id)
     VALUES ('scheduled_logging', $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15)
     ON CONFLICT (candidate_id, job_id) DO NOTHING`,
    [input.candidateId, input.jobId, input.baseResumeId, JSON.stringify(input.alternateResumes), input.atsScore,
      input.aiStatus, input.aiTier, input.aiScore, input.aiReason, input.aiFailureReason, JSON.stringify(input.hardGates),
      input.priority, input.assignedBy, input.assignedTo, input.sourceDecisionId],
  );
}

async function loadCandidates(): Promise<CandidateRow[]> {
  return query<CandidateRow>(
    `SELECT c.id, c.name, c.status, c.pipeline_stage, c.work_authorization, c.visa_status,
            c.preferred_locations,
            COALESCE(r.priority, 'default') AS priority,
            COALESCE(r.preferences, '{}'::jsonb) AS preferences,
            COALESCE(r.custom_requirements, '') AS custom_requirements
       FROM candidates c
       LEFT JOIN scheduled_candidate_logging_candidate_rules r ON r.candidate_id = c.id
       WHERE c.status = 'active'
         AND c.pipeline_stage = 'applying'
         AND COALESCE(r.is_enabled, true) = true
      ORDER BY CASE COALESCE(r.priority, 'default') WHEN 'high' THEN 0 WHEN 'default' THEN 1 ELSE 2 END,
                c.name, c.id`,
  );
}

async function loadResumes(candidateIds: string[]): Promise<Map<string, ResumeRow[]>> {
  if (!candidateIds.length) return new Map();
  const rows = await query<ResumeRow>(
    `SELECT id, candidate_id, name, target_industry, target_roles, content, status
       FROM base_resumes WHERE candidate_id = ANY($1::uuid[]) AND status IN ('draft', 'approved')
       ORDER BY created_at DESC`,
    [candidateIds],
  );
  const byCandidate = new Map<string, ResumeRow[]>();
  for (const resume of rows) {
    const list = byCandidate.get(resume.candidate_id) ?? [];
    list.push(resume);
    byCandidate.set(resume.candidate_id, list);
  }
  return byCandidate;
}

async function resolveDescription(job: IngestedJob): Promise<string> {
  let description = String(job.description_text ?? job.raw_description ?? "").trim();
  if (description.length < 800) {
    const url = [job.source_url, job.apply_url].find((candidate) => candidate && isSafeExternalUrl(candidate));
    if (url) {
      try {
        const fetched = await fetchJobPageText(url);
        if (fetched && fetched.length > description.length) description = fetched;
      } catch (error) {
        console.warn(`[Scheduled candidate logging] Safe job page fetch failed for ${job.job_id}:`, error instanceof Error ? error.name : "fetch_error");
      }
    }
  }
  return description.slice(0, 20_000);
}

function toScoringJob(job: IngestedJob): ScoringJob {
  return {
    job_id: job.job_id, title: job.title, company: job.company, location: job.location,
    seniority_level: job.seniority_level,
    // Freshness here means when the scheduled source entered TalentOS, not
    // the publisher's original posting date (which can be absent or stale).
    freshnessReferenceDate: job.ingested_at,
    requires_citizenship: job.requires_citizenship, citizenship_countries: job.citizenship_countries,
    export_control_restricted: job.export_control_restricted, eligibility_restriction_evidence: job.eligibility_restriction_evidence,
  };
}

export async function runScheduledCandidateLogging(options: {
  triggerType: RunTrigger;
  actorUserId?: string | null;
  runKey?: string;
}) {
  const config = await queryOne<LoggingConfig>("SELECT * FROM scheduled_candidate_logging_config WHERE id = true");
  if (!config) throw new Error("Scheduled candidate-logging migration is not installed.");
  if (!config.is_enabled) return { skipped: true, reason: "Feature is disabled." };
  // BEGIN commented out (restorable together with the matching block in
  // client.tsx and route.ts): this feature used to require its own
  // dedicated AI provider/model/key. Stage 2 now runs through the shared
  // OpenCode pool (see SCHEDULED_LOGGING_AUTOMATION_ID / migration 124), so
  // no per-feature provider/model/key is required to run.
  // if (!config.ai_provider || !config.ai_model || !config.ai_encrypted_api_key) throw new Error("The separate AI provider key and model must be configured.");
  // END commented out
  if (!config.assigned_by_user_id || !config.application_owner_user_id) throw new Error("Select the assigned-by member and application owner before running.");

  const runKey = options.runKey ?? `scheduled-candidate-logging:${options.triggerType}:${randomUUID()}`;
  let run = await queryOne<any>(
    `INSERT INTO scheduled_candidate_logging_runs (run_key, trigger_type, config_snapshot, started_by_user_id)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (run_key) DO NOTHING
     RETURNING *`,
    [runKey, options.triggerType, JSON.stringify({
      threshold: config.match_threshold,
      aiTierCrossCheckFloor: config.ai_match_threshold,
      jobsPerRun: config.jobs_per_run,
      aiCallsPerRun: config.ai_calls_per_run, maxQueuedPerRun: config.max_applications_per_run,
      jobFreshnessDays: config.job_freshness_days,
      provider: "opencode", model: SCHEDULED_LOGGING_AUTOMATION_ID,
      candidateEligibility: "active_applying",
      assignedByUserId: config.assigned_by_user_id,
      applicationOwnerUserId: config.application_owner_user_id,
    }), options.actorUserId ?? null],
  );
  if (!run) {
    const existing = await queryOne<any>("SELECT * FROM scheduled_candidate_logging_runs WHERE run_key = $1", [runKey]);
    if (!existing) throw new Error("Could not create scheduled logging run.");
    return { runId: existing.id, status: existing.status, skipped: true, reason: "This run key has already been processed." };
  }
  let aiCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let pairCount = 0;
  let queuedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let jobsSeen = 0;
  let pending = false;
  let currentEventId: string | null = null;
  const persistProgress = () => query(
    `UPDATE scheduled_candidate_logging_runs SET jobs_seen = $2, candidate_pairs_scored = $3,
        applications_created = $4, skipped_count = $5, failed_count = $6,
        ai_calls = $7, input_tokens = $8, output_tokens = $9
      WHERE id = $1 AND status = 'running'`,
    [run.id, jobsSeen, pairCount, queuedCount, skippedCount, failedCount, aiCalls, inputTokens, outputTokens],
  );
  try {
    const jobs = await query<IngestedJob>(
      `SELECT e.id AS event_id, e.job_id, e.source, e.ingested_at,
              j.title, j.company, j.location, j.source_url, j.apply_url,
              j.description_text, j.raw_description, j.posted_at::text,
              j.seniority_level, j.job_category, j.is_active,
              j.requires_citizenship, j.citizenship_countries,
              j.export_control_restricted, j.eligibility_restriction_evidence
         FROM scheduled_job_ingestion_events e JOIN jobs j ON j.id = e.job_id
        WHERE (e.processing_status IN ('pending','failed')
           OR (e.processing_status = 'processing' AND e.updated_at < NOW() - INTERVAL '30 minutes'))
        ORDER BY e.attempts ASC, e.ingested_at ASC LIMIT $1`,
      [config.jobs_per_run],
    );
    const candidates = await loadCandidates();
    const resumesByCandidate = await loadResumes(candidates.map((candidate) => candidate.id));

    for (const job of jobs) {
      const claimed = await queryOne<{ id: string }>(
        `UPDATE scheduled_job_ingestion_events
            SET processing_status = 'processing', attempts = attempts + 1, updated_at = NOW()
          WHERE id = $1 AND (
            processing_status IN ('pending', 'failed') OR
            (processing_status = 'processing' AND updated_at < NOW() - INTERVAL '30 minutes')
          )
          RETURNING id`,
        [job.event_id],
      );
      if (!claimed) continue;
      jobsSeen++;
      currentEventId = job.event_id;
      if (!job.is_active) {
        await query("UPDATE scheduled_job_ingestion_events SET processing_status = 'complete', updated_at = NOW(), last_error = 'Job is inactive' WHERE id = $1", [job.event_id]);
        skippedCount++;
        await persistProgress();
        currentEventId = null;
        continue;
      }
      const description = await resolveDescription(job);
      const scoringJob = toScoringJob(job);
      let jobPending = false;
      for (const candidate of candidates) {
        const resumes = resumesByCandidate.get(candidate.id) ?? [];
        if (!resumes.length) {
          await saveDecision({ runId: run.id, job, candidateId: candidate.id, priority: candidate.priority, status: "no_approved_resume", reason: "No approved base resume is available." });
          skippedCount++;
          continue;
        }
        const prior = await queryOne<{ status: string }>(
          `SELECT status FROM scheduled_candidate_logging_decisions WHERE ingestion_event_id = $1 AND candidate_id = $2`,
          [job.event_id, candidate.id],
        );
        if (prior && ["below_threshold", "ineligible", "existing_application", "no_approved_resume", "description_unavailable", "application_created", "pending_review"].includes(prior.status)) {
          continue;
        }

        // Global dedup ("a job is excluded for everyone the moment anyone
        // has applied to it"): check before spending any scoring work, not
        // just before creating an application.
        const [existingApplication, existingQueueItem] = await Promise.all([
          queryOne<{ id: string }>("SELECT id FROM applications WHERE job_id = $1 LIMIT 1", [job.job_id]),
          queryOne<{ id: string }>("SELECT id FROM candidate_job_review_queue WHERE job_id = $1 AND status IN ('pending','approved') LIMIT 1", [job.job_id]),
        ]);
        if (existingApplication || existingQueueItem) {
          await saveDecision({ runId: run.id, job, candidateId: candidate.id, priority: candidate.priority,
            status: "existing_application", reason: "Another candidate already has an application (or a pending review item) for this job." });
          skippedCount++;
          continue;
        }

        if (description.length < 250) {
          await saveDecision({ runId: run.id, job, candidateId: candidate.id, priority: candidate.priority, status: "description_unavailable", reason: "A usable job description was not available after the safe page-fetch attempt." });
          skippedCount++;
          continue;
        }

        // Stage 1: deterministic keyword/ATS score across every draft/
        // approved resume (lane-breadth). match_threshold is now a low noise
        // floor, not a fit-quality pass bar - hard gates (free-text +
        // structured citizenship/clearance) are warnings attached to the
        // queued item, never a silent exclusion.
        const stage1 = scoreStage1(candidate, resumes, description, scoringJob, config.job_freshness_days);
        if (!stage1.bestResume || stage1.bestScore < config.match_threshold) {
          await saveDecision({ runId: run.id, job, candidateId: candidate.id, resumeId: stage1.bestResume?.id,
            deterministicScore: stage1.bestScore, score: stage1.bestScore, priority: candidate.priority,
            status: "below_threshold", reason: `Keyword/ATS score ${stage1.bestScore} is below the ${config.match_threshold}% Stage 1 floor.` });
          skippedCount++;
          continue;
        }

        // Stage 2 (AI tiering) is the minority-of-pairs step the "minimum AI
        // tokens" goal is about. Cap on either AI calls or review-queue
        // slots before spending the call - no point scoring a pair that
        // can't be queued this run anyway.
        if (aiCalls >= config.ai_calls_per_run || queuedCount >= config.max_applications_per_run) {
          jobPending = true;
          pending = true;
          continue;
        }
        aiCalls++;
        pairCount++;
        const stage2 = await scoreStage2({
          customPrompt: config.custom_prompt, job: scoringJob, candidate, resume: stage1.bestResume,
          description, deterministicScore: stage1.bestScore, crossCheckFloor: config.ai_match_threshold, runId: run.id,
        });

        if (stage2.status === "failed") {
          // AI failure must never block the pipeline: queue ATS-only
          // instead of waiting for a future batch to retry. An admin/
          // manager can retry Stage 2 for this one item from the review page.
          const decisionId = await saveDecision({ runId: run.id, job, candidateId: candidate.id, resumeId: stage1.bestResume.id,
            deterministicScore: stage1.bestScore, priority: candidate.priority, status: "pending_review",
            reason: "AI eligibility check unavailable; queued for review with the ATS score only.",
            provider: stage2.provider, model: stage2.model });
          await queueForReview({
            candidateId: candidate.id, jobId: job.job_id, baseResumeId: stage1.bestResume.id,
            alternateResumes: stage1.rankedResumes, atsScore: stage1.bestScore,
            aiStatus: "failed", aiTier: null, aiScore: null, aiReason: null, aiFailureReason: stage2.failureReason,
            hardGates: stage1.hardGates, priority: candidate.priority,
            assignedBy: config.assigned_by_user_id, assignedTo: config.application_owner_user_id,
            sourceDecisionId: decisionId,
          });
          queuedCount++;
          failedCount++;
          continue;
        }

        inputTokens += stage2.inputTokens;
        outputTokens += stage2.outputTokens;
        if (stage2.tier === "reject") {
          await saveDecision({ runId: run.id, job, candidateId: candidate.id, resumeId: stage1.bestResume.id,
            deterministicScore: stage1.bestScore, score: stage2.score, priority: candidate.priority, status: "below_threshold",
            reason: stage2.reason, provider: stage2.provider, model: stage2.model,
            inputTokens: stage2.inputTokens, outputTokens: stage2.outputTokens });
          skippedCount++;
          continue;
        }

        const decisionId = await saveDecision({ runId: run.id, job, candidateId: candidate.id, resumeId: stage1.bestResume.id,
          deterministicScore: stage1.bestScore, score: stage2.score, priority: candidate.priority, status: "pending_review",
          reason: stage2.reason, provider: stage2.provider, model: stage2.model,
          inputTokens: stage2.inputTokens, outputTokens: stage2.outputTokens });
        await queueForReview({
          candidateId: candidate.id, jobId: job.job_id, baseResumeId: stage1.bestResume.id,
          alternateResumes: stage1.rankedResumes, atsScore: stage1.bestScore,
          aiStatus: "scored", aiTier: stage2.tier, aiScore: stage2.score, aiReason: stage2.reason, aiFailureReason: null,
          hardGates: [...stage1.hardGates, ...stage2.hardGates], priority: candidate.priority,
          assignedBy: config.assigned_by_user_id, assignedTo: config.application_owner_user_id,
          sourceDecisionId: decisionId,
        });
        queuedCount++;
      }
      if (jobPending) {
        pending = true;
        await query("UPDATE scheduled_job_ingestion_events SET processing_status = 'pending', updated_at = NOW(), last_error = NULL WHERE id = $1", [job.event_id]);
      } else {
        await query("UPDATE scheduled_job_ingestion_events SET processing_status = 'complete', updated_at = NOW(), last_error = NULL WHERE id = $1", [job.event_id]);
      }
      // The Activity page polls while this request is still running. Persist
      // completed-job counters so a slow AI batch does not appear idle.
      await persistProgress();
      currentEventId = null;
    }

    const status = pending ? "partial" : "completed";
    await query(
      `UPDATE scheduled_candidate_logging_runs SET status = $2, jobs_seen = $3,
          candidate_pairs_scored = $4, applications_created = $5, skipped_count = $6,
          failed_count = $7, ai_calls = $8, input_tokens = $9, output_tokens = $10,
          finished_at = NOW() WHERE id = $1`,
      [run.id, status, jobsSeen, pairCount, queuedCount, skippedCount, failedCount, aiCalls, inputTokens, outputTokens],
    );
    return { runId: run.id, status, jobsSeen, candidatePairsScored: pairCount,
      queuedForReview: queuedCount, skippedCount, failedCount, aiCalls, inputTokens, outputTokens, pending };
  } catch (error) {
    if (currentEventId) {
      await query(
        `UPDATE scheduled_job_ingestion_events SET processing_status = 'failed', updated_at = NOW(), last_error = $2 WHERE id = $1`,
        [currentEventId, (error instanceof Error ? error.message : String(error)).slice(0, 1000)],
      ).catch(() => undefined);
    }
    await query("UPDATE scheduled_candidate_logging_runs SET status = 'failed', error_message = $2, finished_at = NOW() WHERE id = $1", [run.id, (error instanceof Error ? error.message : String(error)).slice(0, 1000)]).catch(() => undefined);
    throw error;
  }
}
