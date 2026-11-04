import { randomUUID } from "crypto";
import { isSafeExternalUrl, fetchJobPageText } from "@/lib/ai/job-agents/fetchJobPage";
import { query, queryOne } from "@/server/db/neon";
import type { AiProvider as DbAiProvider } from "@/server/repositories/aiKeyRepository";
import {
  scoreStage1, scoreStage2, SCHEDULED_LOGGING_AUTOMATION_ID,
  type CandidatePriority, type ScoringCandidate, type ScoringResume, type ScoringJob,
} from "@/server/services/candidateJobScoring";

// Re-exported for existing test coverage and any other callers that still
// import these from here rather than the shared scoring module directly.
export { provesCitizenshipOf, checkStructuredEligibility, parseEligibilityResponse } from "@/server/services/candidateJobScoring";

import {
  CHUNK_BUDGET_MS, MAX_RECOVERIES, ScheduledLoggingLeaseLost, claimLoggingRun, requestLoggingRun,
  checkpointLoggingRun, leasedWrites, leasePredicate, type LoggingRun,
} from "./scheduledLoggingExecution";

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

interface DecisionInput {
  job: IngestedJob; candidateId: string; resumeId?: string | null;
  deterministicScore?: number | null; score?: number | null; priority: CandidatePriority;
  status: string; reason: string; provider?: string | null; model?: string | null;
  inputTokens?: number; outputTokens?: number;
}
function decisionStatement(run: LoggingRun, input: DecisionInput) {
  const lease = leasePredicate(run, 15);
  return {
    text: `INSERT INTO scheduled_candidate_logging_decisions
      (run_id,ingestion_event_id,job_id,candidate_id,base_resume_id,deterministic_score,match_score,
       priority,status,reason,provider,model,input_tokens,output_tokens)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14 WHERE ${lease.text}
      ON CONFLICT (ingestion_event_id,candidate_id) DO UPDATE SET
        run_id=EXCLUDED.run_id,base_resume_id=EXCLUDED.base_resume_id,deterministic_score=EXCLUDED.deterministic_score,
        match_score=EXCLUDED.match_score,priority=EXCLUDED.priority,status=EXCLUDED.status,reason=EXCLUDED.reason,
        provider=EXCLUDED.provider,model=EXCLUDED.model,input_tokens=EXCLUDED.input_tokens,output_tokens=EXCLUDED.output_tokens,updated_at=NOW()
      RETURNING id`,
    values: [run.id,input.job.event_id,input.job.job_id,input.candidateId,input.resumeId ?? null,
      input.deterministicScore ?? null,input.score ?? null,input.priority,input.status,input.reason.slice(0,2000),
      input.provider ?? null,input.model ?? null,input.inputTokens ?? 0,input.outputTokens ?? 0,...lease.values],
  };
}
async function saveDecision(run: LoggingRun, input: DecisionInput) {
  await leasedWrites(run, [decisionStatement(run, input)]);
}
async function saveReviewPair(run: LoggingRun, input: DecisionInput, review: {
  alternateResumes: { resumeId: string; resumeName: string | null; score: number }[];
  aiStatus: "scored" | "failed"; aiTier: string | null; aiScore: number | null;
  aiReason: string | null; aiFailureReason: string | null; hardGates: string[];
  assignedBy: string; assignedTo: string;
}): Promise<boolean> {
  const lease = leasePredicate(run, 17);
  const results = await leasedWrites(run, [decisionStatement(run, input), {
    text: `INSERT INTO candidate_job_review_queue
      (source,candidate_id,job_id,base_resume_id,alternate_resumes,ats_score,ai_status,ai_tier,ai_score,
       ai_reason,ai_failure_reason,hard_gates,priority,assigned_by_user_id,assigned_to_user_id,source_decision_id)
      SELECT 'scheduled_logging',$1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,d.id
      FROM scheduled_candidate_logging_decisions d WHERE d.ingestion_event_id=$15 AND d.candidate_id=$1 AND d.run_id=$16
        AND ${lease.text}
        AND NOT EXISTS (SELECT 1 FROM candidate_job_review_queue WHERE job_id=$2 AND status IN ('pending','approved'))
        AND NOT EXISTS (SELECT 1 FROM applications WHERE job_id=$2)
      ON CONFLICT (candidate_id,job_id) DO NOTHING RETURNING id`,
    values: [input.candidateId,input.job.job_id,input.resumeId,JSON.stringify(review.alternateResumes),input.deterministicScore,
      review.aiStatus,review.aiTier,review.aiScore,review.aiReason,review.aiFailureReason,JSON.stringify(review.hardGates),input.priority,
      review.assignedBy,review.assignedTo,input.job.event_id,run.id,...lease.values],
  }, {
    text: `UPDATE scheduled_candidate_logging_decisions d SET status='existing_application',
      reason='This job was claimed for review or application while AI scoring was in progress.',updated_at=NOW()
      WHERE d.ingestion_event_id=$1 AND d.candidate_id=$2 AND d.run_id=$3
        AND NOT EXISTS (SELECT 1 FROM candidate_job_review_queue WHERE source_decision_id=d.id)
        AND ${leasePredicate(run, 4).text}`,
    values: [input.job.event_id,input.candidateId,run.id,...leasePredicate(run,4).values],
  }]);
  return (results[1] as unknown[]).length > 0;
}
async function setEventState(run: LoggingRun, eventId: string, state: string) {
  const lease = leasePredicate(run, 3);
  const result = await leasedWrites(run, [{
    text: `UPDATE scheduled_job_ingestion_events SET processing_status=$2,updated_at=NOW(),last_error=NULL
      WHERE id=$1 AND ${lease.text} RETURNING id`, values: [eventId,state,...lease.values],
  }]);
  if (!(result[0] as unknown[]).length) throw new ScheduledLoggingLeaseLost();
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

export function loggingRunResult(run: LoggingRun) {
  return { runId:run.id,status:run.status,phase:run.config_snapshot.execution?.phase,
    jobsSeen:run.jobs_seen,candidatePairsScored:run.candidate_pairs_scored,queuedForReview:run.applications_created,
    skippedCount:run.skipped_count,failedCount:run.failed_count,aiCalls:run.ai_calls,
    inputTokens:run.input_tokens,outputTokens:run.output_tokens,pending:run.status === "running" || run.status === "partial" };
}

/** Durable acceptance only: never hold a UI/GitHub HTTP request open for the batch. */
export async function enqueueScheduledCandidateLogging(options: {
  triggerType: RunTrigger; actorUserId?: string | null; runKey?: string;
}) {
  const config = await queryOne<LoggingConfig>("SELECT * FROM scheduled_candidate_logging_config WHERE id = true");
  if (!config) throw new Error("Scheduled candidate-logging migration is not installed.");
  if (!config.is_enabled) return { skipped:true,reason:"Feature is disabled." };
  if (!config.assigned_by_user_id || !config.application_owner_user_id) throw new Error("Select the assigned-by member and application owner before running.");
  await claimLoggingRun(false); // Reconcile orphaned runs, without starting AI work.
  const run = await requestLoggingRun({
    runKey:options.runKey ?? `scheduled-candidate-logging:${options.triggerType}:${randomUUID()}`,
    triggerType:options.triggerType,actorUserId:options.actorUserId,jobsPerRun:config.jobs_per_run,
    snapshot:{ threshold:config.match_threshold,aiTierCrossCheckFloor:config.ai_match_threshold,
      jobsPerRun:config.jobs_per_run,aiCallsPerRun:config.ai_calls_per_run,maxQueuedPerRun:config.max_applications_per_run,
      jobFreshnessDays:config.job_freshness_days,provider:"opencode",model:SCHEDULED_LOGGING_AUTOMATION_ID,
      candidateEligibility:"active_applying",assignedByUserId:config.assigned_by_user_id,applicationOwnerUserId:config.application_owner_user_id,
      // Only execution settings; the retired dedicated provider/key fields are never copied.
      settings:{match_threshold:config.match_threshold,ai_match_threshold:config.ai_match_threshold,
        ai_calls_per_run:config.ai_calls_per_run,max_applications_per_run:config.max_applications_per_run,
        job_freshness_days:config.job_freshness_days,custom_prompt:config.custom_prompt,
        assigned_by_user_id:config.assigned_by_user_id,application_owner_user_id:config.application_owner_user_id},
    },
  });
  return loggingRunResult(run);
}

/** One bounded, fenced chunk. Cloudflare's minute tick continues the same run. */
export async function continueScheduledCandidateLogging() {
  const run = await claimLoggingRun();
  if (!run) return { skipped:true,reason:"No batch is ready, or another executor holds its lease." };
  const deadline = Date.now() + CHUNK_BUDGET_MS;
  const config = run.config_snapshot.settings as LoggingConfig;
  const state = run.config_snapshot.execution;
  let currentEventId: string | null = null;
  let retryAfterMs = 0;
  let capped = false;
  const beat = () => checkpointLoggingRun(run, state);
  try {
    const liveConfig = await queryOne<{is_enabled:boolean}>("SELECT is_enabled FROM scheduled_candidate_logging_config WHERE id = true");
    if (!liveConfig?.is_enabled) {
      await checkpointLoggingRun(run,{...state,phase:"finished",leaseToken:null,leaseUntil:null},"partial","Feature was disabled; unprocessed jobs remain queued.");
      return loggingRunResult(run);
    }
    const jobs = await query<IngestedJob>(
      `SELECT e.id AS event_id,e.job_id,e.source,e.ingested_at,
        j.title,j.company,j.location,j.source_url,j.apply_url,j.description_text,j.raw_description,j.posted_at::text,
        j.seniority_level,j.job_category,j.is_active,j.requires_citizenship,j.citizenship_countries,
        j.export_control_restricted,j.eligibility_restriction_evidence
       FROM scheduled_job_ingestion_events e JOIN jobs j ON j.id=e.job_id
       WHERE e.id=ANY($1::uuid[]) AND NOT(e.id=ANY($2::uuid[]))
       ORDER BY e.attempts ASC,e.ingested_at ASC,e.id`,[state.eventIds,state.completedEventIds]);
    const candidates = await loadCandidates();
    const resumesByCandidate = await loadResumes(candidates.map(candidate => candidate.id));
    jobsLoop: for (const job of jobs) {
      if (Date.now() >= deadline - 3_000) break;
      if (run.ai_calls >= config.ai_calls_per_run || run.applications_created >= config.max_applications_per_run) { capped=true;break; }
      state.currentEventId=job.event_id;
      await beat();
      const lease=leasePredicate(run,2);
      const [claimed] = await leasedWrites(run,[{
        text:`UPDATE scheduled_job_ingestion_events SET processing_status='processing',attempts=attempts+1,updated_at=NOW()
          WHERE id=$1 AND (processing_status IN ('pending','failed') OR
            (processing_status='processing' AND updated_at<NOW()-INTERVAL '30 minutes')) AND ${lease.text} RETURNING id`,
        values:[job.event_id,...lease.values],
      }]);
      if (!(claimed as unknown[]).length) {state.completedEventIds.push(job.event_id);state.currentEventId=null;continue;}
      currentEventId=job.event_id;
      if (!state.startedEventIds.includes(job.event_id)) {state.startedEventIds.push(job.event_id);run.jobs_seen++;}
      await beat();
      if (!job.is_active) {run.skipped_count++;}
      else {
        const description=await resolveDescription(job);
        const scoringJob=toScoringJob(job);
        for (const candidate of candidates) {
          if (Date.now() >= deadline - 3_000) break jobsLoop;
          const resumes=resumesByCandidate.get(candidate.id) ?? [];
          const prior=await queryOne<{status:string}>(`SELECT status FROM scheduled_candidate_logging_decisions WHERE ingestion_event_id=$1 AND candidate_id=$2`,[job.event_id,candidate.id]);
          if (prior && ["below_threshold","ineligible","existing_application","no_approved_resume","description_unavailable","application_created","pending_review"].includes(prior.status)) continue;
          const common={job,candidateId:candidate.id,priority:candidate.priority};
          if (!resumes.length) {await saveDecision(run,{...common,status:"no_approved_resume",reason:"No draft or approved base resume is available."});run.skipped_count++;await beat();continue;}
          const [application,review]=await Promise.all([
            queryOne("SELECT id FROM applications WHERE job_id=$1 LIMIT 1",[job.job_id]),
            queryOne("SELECT id FROM candidate_job_review_queue WHERE job_id=$1 AND status IN ('pending','approved') LIMIT 1",[job.job_id]),
          ]);
          if (application || review) {await saveDecision(run,{...common,status:"existing_application",reason:"This job already has an application or a pending review item."});run.skipped_count++;await beat();continue;}
          if (description.length<250) {await saveDecision(run,{...common,status:"description_unavailable",reason:"A usable job description was not available after the safe page-fetch attempt."});run.skipped_count++;await beat();continue;}
          const stage1=scoreStage1(candidate,resumes,description,scoringJob,config.job_freshness_days);
          const decision={...common,resumeId:stage1.bestResume?.id,deterministicScore:stage1.bestScore};
          if (!stage1.bestResume || stage1.bestScore<config.match_threshold) {
            await saveDecision(run,{...decision,score:stage1.bestScore,status:"below_threshold",reason:`Keyword/ATS score ${stage1.bestScore} is below the ${config.match_threshold}% Stage 1 floor.`});
            run.skipped_count++;await beat();continue;
          }
          if (run.ai_calls>=config.ai_calls_per_run || run.applications_created>=config.max_applications_per_run) {capped=true;break jobsLoop;}
          // Reserve before spending: a terminated chunk cannot reset the per-run AI budget.
          run.ai_calls++;run.candidate_pairs_scored++;await beat();
          const stage2=await scoreStage2({customPrompt:config.custom_prompt,job:scoringJob,candidate,resume:stage1.bestResume,
            description,deterministicScore:stage1.bestScore,crossCheckFloor:config.ai_match_threshold,runId:run.id,
            scheduledExecution:{deadlineAt:Math.min(deadline-2_000,Date.now()+20_000)},
          });
          await beat(); // Verify the lease again before any result can change a decision.
          if (stage2.status==="failed" && stage2.retryAfterMs) {
            run.failed_count++;retryAfterMs=stage2.retryAfterMs;
            await saveDecision(run,{...decision,status:"ai_failed",reason:stage2.failureReason,provider:stage2.provider,model:stage2.model});
            break jobsLoop;
          }
          if (stage2.status==="scored") {run.input_tokens+=stage2.inputTokens;run.output_tokens+=stage2.outputTokens;}
          if (stage2.status==="scored" && stage2.tier==="reject") {
            await saveDecision(run,{...decision,score:stage2.score,status:"below_threshold",reason:stage2.reason,
              provider:stage2.provider,model:stage2.model,inputTokens:stage2.inputTokens,outputTokens:stage2.outputTokens});
            run.skipped_count++;await beat();continue;
          }
          const failed=stage2.status==="failed";
          const queued=await saveReviewPair(run,{...decision,status:"pending_review",score:failed?null:stage2.score,
            reason:failed?"AI eligibility check unavailable; queued for review with the ATS score only.":stage2.reason,
            provider:stage2.provider,model:stage2.model,inputTokens:failed?0:stage2.inputTokens,outputTokens:failed?0:stage2.outputTokens},
          {alternateResumes:stage1.rankedResumes,aiStatus:failed?"failed":"scored",aiTier:failed?null:stage2.tier,
            aiScore:failed?null:stage2.score,aiReason:failed?null:stage2.reason,aiFailureReason:failed?stage2.failureReason:null,
            hardGates:failed?stage1.hardGates:[...stage1.hardGates,...stage2.hardGates],
            assignedBy:config.assigned_by_user_id!,assignedTo:config.application_owner_user_id!});
          if (queued) {run.applications_created++;if(failed)run.failed_count++;} else run.skipped_count++;
          await beat();
        }
      }
      await setEventState(run,job.event_id,"complete");
      state.completedEventIds.push(job.event_id);state.currentEventId=null;currentEventId=null;await beat();
    }
    if (currentEventId) await setEventState(run,currentEventId,"pending");
    const finished=state.completedEventIds.length>=state.eventIds.length;
    const status=finished?"completed":capped?"partial":"running";
    await checkpointLoggingRun(run,{...state,currentEventId:null,leaseToken:null,leaseUntil:null,
      phase:status!=="running"?"finished":retryAfterMs?"waiting":"queued",
      nextAttemptAt:retryAfterMs?new Date(Date.now()+retryAfterMs).toISOString():null},status);
    run.status=status;
    return loggingRunResult(run);
  } catch(error) {
    if (error instanceof ScheduledLoggingLeaseLost) return {...loggingRunResult(run),leaseLost:true};
    const message=(error instanceof Error?error.message:String(error)).slice(0,1000);
    try {
      if(currentEventId) await setEventState(run,currentEventId,"pending");
      const transient=/connection (?:reset|terminated|closed)|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket|fetch failed|network|timeout/i.test(message);
      if(transient && state.recoveries<MAX_RECOVERIES) {
        await checkpointLoggingRun(run,{...state,currentEventId:null,phase:"waiting",leaseToken:null,leaseUntil:null,
          recoveries:state.recoveries+1,nextAttemptAt:new Date(Date.now()+60000).toISOString()},"running",`Temporary connection error; retrying automatically. ${message}`);
        return {...loggingRunResult(run),retrying:true};
      }
      await checkpointLoggingRun(run,{...state,currentEventId:null,phase:"finished",leaseToken:null,leaseUntil:null},"failed",message);
    } catch { /* If storage is unreachable, the lease watchdog recovers the chunk on a later tick. */ }
    throw error;
  }
}

// Kept for scripts and existing callers. The HTTP routes enqueue only;
// this helper performs at most ONE short chunk, never the whole large batch.
export async function runScheduledCandidateLogging(options: {
  triggerType:RunTrigger;actorUserId?:string|null;runKey?:string;
}) {
  const accepted=await enqueueScheduledCandidateLogging(options);
  if ('skipped' in accepted || accepted.status!=="running") return accepted;
  return continueScheduledCandidateLogging();
}
