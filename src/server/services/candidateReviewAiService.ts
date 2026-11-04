import { randomUUID } from "crypto";
import { queryOne } from "@/server/db/neon";
import { assessmentForHumanReview } from "@/lib/candidateReviewAssessment";
import { scoreStage2, type ScoringCandidate, type ScoringJob, type ScoringResume } from "./candidateJobScoring";

const MAX_ATTEMPTS = 3;
const LEASE_SECONDS = 120;
type ClaimedReview = {
  id: string; candidate_id: string; job_id: string; base_resume_id: string | null;
  ats_score: number | null; hard_gates: string[];
  ai_execution: { attempts: number; leaseToken: string };
};

/** Atomic, short claim. Concurrent HTTP/cron workers cannot score the same row. */
async function claimReview(ids?: string[]): Promise<ClaimedReview | null> {
  const token = randomUUID();
  return queryOne<ClaimedReview>(`UPDATE candidate_job_review_queue q
    SET ai_execution = q.ai_execution || jsonb_build_object(
      'leaseToken',$1::text,'leaseUntil',NOW()+make_interval(secs=>$2),
      'attempts',COALESCE((q.ai_execution->>'attempts')::int,0)+1,'startedAt',NOW()), updated_at=NOW()
    WHERE q.id=(SELECT id FROM candidate_job_review_queue
      WHERE source='extension' AND status='pending' AND ai_status='pending'
        AND ($3::uuid[] IS NULL OR id=ANY($3::uuid[]))
        AND COALESCE((ai_execution->>'leaseUntil')::timestamptz,'-infinity'::timestamptz)<=NOW()
        AND COALESCE((ai_execution->>'nextAttemptAt')::timestamptz,'-infinity'::timestamptz)<=NOW()
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING q.*`, [token, LEASE_SECONDS, ids?.length ? ids : null]);
}

async function finishReview(row: ClaimedReview, result: {
  status: "pending" | "scored" | "failed"; reason?: string;
  tier?: string | null; score?: number | null; aiReason?: string | null; gates?: string[];
  provider?: string; model?: string | null; elapsedMs: number;
}) {
  const retrySeconds = result.status === "pending" ? 60 * row.ai_execution.attempts : 0;
  // The token and live lease fence every result. Approval/rejection, a newer
  // retry, or recovery of a dead worker makes the old result a harmless no-op.
  return queryOne<{id:string}>(`UPDATE candidate_job_review_queue q SET
      ai_status=$3,ai_tier=$4,ai_score=$5,ai_reason=$6,ai_failure_reason=$7,
      hard_gates=$8::jsonb,updated_at=NOW(),
      ai_execution=(q.ai_execution-'leaseToken'-'leaseUntil') || jsonb_build_object(
        'finishedAt',NOW(),'elapsedMs',$9::int,'provider',$10::text,'model',$11::text,
        'nextAttemptAt',CASE WHEN $3::text='pending' THEN NOW()+make_interval(secs=>$12) ELSE NULL END)
    WHERE q.id=$1 AND q.source='extension' AND q.status='pending' AND q.ai_status='pending'
      AND q.ai_execution->>'leaseToken'=$2
      AND (q.ai_execution->>'leaseUntil')::timestamptz>NOW() RETURNING q.id`,
  [row.id,row.ai_execution.leaseToken,result.status,result.tier??null,result.score??null,
    result.aiReason??null,result.reason??null,JSON.stringify(result.gates??row.hard_gates),
    result.elapsedMs,result.provider??null,result.model??null,retrySeconds]);
}

async function scoreClaim(row: ClaimedReview, deadlineAt: number) {
  const started = Date.now();
  try {
    if (row.ai_execution.attempts > MAX_ATTEMPTS) {
      await finishReview(row,{status:"failed",reason:"AI scoring was interrupted repeatedly. ATS is available; a reviewer can decide or retry AI.",elapsedMs:0});
      return;
    }
    const [job,candidate,resume,config] = await Promise.all([
      queryOne<ScoringJob & {description_text:string|null;raw_description:string|null}>(
        `SELECT id AS job_id,title,company,location,seniority_level,description_text,raw_description,
          requires_citizenship,citizenship_countries,export_control_restricted,eligibility_restriction_evidence
         FROM jobs WHERE id=$1`,[row.job_id]),
      queryOne<ScoringCandidate>(`SELECT c.id,c.name,c.work_authorization,c.visa_status,c.preferred_locations,
          COALESCE(r.priority,'default') AS priority,COALESCE(r.preferences,'{}'::jsonb) AS preferences,
          COALESCE(r.custom_requirements,'') AS custom_requirements
        FROM candidates c LEFT JOIN scheduled_candidate_logging_candidate_rules r ON r.candidate_id=c.id WHERE c.id=$1`,[row.candidate_id]),
      queryOne<ScoringResume>("SELECT id,candidate_id,name,target_industry,target_roles,content,status FROM base_resumes WHERE id=$1",[row.base_resume_id]),
      queryOne<{custom_prompt:string;ai_match_threshold:number}>("SELECT custom_prompt,ai_match_threshold FROM scheduled_candidate_logging_config LIMIT 1"),
    ]);
    if (!job || !candidate || !resume || resume.candidate_id !== row.candidate_id || resume.status === "archived") {
      await finishReview(row,{status:"failed",reason:"Job, candidate or selected base resume is no longer available for AI scoring.",elapsedMs:Date.now()-started});
      return;
    }
    const description=String(job.description_text??job.raw_description??"").slice(0,20_000);
    if(description.length<250) {
      await finishReview(row,{status:"failed",reason:"Job description too short for AI scoring. ATS remains available for human review.",elapsedMs:Date.now()-started});
      return;
    }
    const outcome=await scoreStage2({customPrompt:config?.custom_prompt??"",job:{...job,freshnessReferenceDate:null},candidate,resume,
      description,deterministicScore:row.ats_score??0,crossCheckFloor:config?.ai_match_threshold,
      reviewExecution:{deadlineAt}});
    if(outcome.status === "failed") {
      await finishReview(row,{status:row.ai_execution.attempts<MAX_ATTEMPTS?"pending":"failed",reason:outcome.failureReason,
        provider:outcome.provider,model:outcome.model,elapsedMs:Date.now()-started});
      return;
    }
    const review=assessmentForHumanReview(outcome);
    await finishReview(row,{status:"scored",tier:review.aiTier,score:outcome.score,aiReason:review.aiReason,
      gates:[...new Set([...row.hard_gates,...review.hardGates])],provider:outcome.provider,model:outcome.model,elapsedMs:Date.now()-started});
  } catch(error) {
    await finishReview(row,{status:row.ai_execution.attempts<MAX_ATTEMPTS?"pending":"failed",
      reason:(error instanceof Error?error.message:"AI scoring failed.").slice(0,1000),elapsedMs:Date.now()-started});
  }
}

/** At most two concurrent checks. The pending row survives HTTP interruption. */
export async function processPendingReviewAi(options: {ids?:string[];budgetMs?:number} = {}) {
  if(options.ids && !options.ids.length) return {processed:0};
  // Leave time for usage/trace writes and fenced persistence after AI stops.
  const deadlineAt=Date.now()+Math.min(50_000,Math.max(3_000,options.budgetMs??25_000))-2_000;
  const rows=await Promise.all([claimReview(options.ids),claimReview(options.ids)]);
  await Promise.all(rows.filter((row):row is ClaimedReview=>Boolean(row)).map(row=>scoreClaim(row,deadlineAt)));
  return {processed:rows.filter(Boolean).length};
}

export async function enqueueExtensionReviewAiRetry(id: string): Promise<void> {
  const row=await queryOne<{id:string}>(`UPDATE candidate_job_review_queue SET ai_status='pending',ai_tier=NULL,
      ai_score=NULL,ai_reason=NULL,ai_failure_reason=NULL,ai_execution='{}'::jsonb,updated_at=NOW()
    WHERE id=$1 AND source='extension' AND status='pending' AND base_resume_id IS NOT NULL
      AND ai_status<>'pending' RETURNING id`,[id]);
  if(!row) {
    const existing=await queryOne<{status:string;ai_status:string;base_resume_id:string|null}>("SELECT status,ai_status,base_resume_id FROM candidate_job_review_queue WHERE id=$1 AND source='extension'",[id]);
    if(existing?.status==="pending" && existing.base_resume_id && existing.ai_status==="pending") return;
    throw new Error("Only a pending extension review with a selected base resume can be re-scored.");
  }
}
