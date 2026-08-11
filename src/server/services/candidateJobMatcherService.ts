import { randomUUID } from "crypto";
import { evaluateCandidateJob } from "@/lib/candidateJobMatcher";
import { sha256Hex } from "@/lib/sha256";
import { query, queryOne } from "@/server/db/neon";
import { triggerAiWorkflowForApplication } from "@/server/services/applicationAiWorkflowService";

export type CandidateJobMatcherMode = "dry_run" | "ae_review";

interface SearchProfileRow {
  id: string;
  candidate_id: string;
  base_resume_id: string;
  profile_version: number;
  approved_profile_version: number | null;
  resume_content_hash: string | null;
  keywords: string[] | null;
  keyword_states: unknown;
  additional_rules: string | null;
  resume_content: unknown;
  candidate_name: string;
  work_authorization: string | null;
  visa_status: string | null;
  preferred_locations: string | null;
}

interface RecentJobRow {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  description_text: string | null;
  raw_description: string | null;
  seniority_level: string | null;
  posted_at: string | null;
}

interface KeywordState { term?: unknown; status?: unknown }

function keywordSets(row: SearchProfileRow): { active: string[]; dismissed: string[] } {
  const states = Array.isArray(row.keyword_states) ? row.keyword_states as KeywordState[] : [];
  if (!states.length) return { active: Array.isArray(row.keywords) ? row.keywords : [], dismissed: [] };
  const active: string[] = [];
  const dismissed: string[] = [];
  for (const state of states) {
    if (typeof state.term !== "string" || !state.term.trim()) continue;
    if (state.status === "dismissed") dismissed.push(state.term.trim());
    else active.push(state.term.trim());
  }
  return { active, dismissed };
}

function dhakaDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function resumeText(content: unknown): string {
  if (typeof content === "string") return content;
  try { return JSON.stringify(content ?? {}); } catch { return ""; }
}

export async function resolveDefaultApplicationEngineer(configuredId?: string | null): Promise<string | null> {
  if (configuredId) {
    const configured = await queryOne<{ user_id: string }>(
      `SELECT user_id FROM profiles
        WHERE user_id = $1 AND is_active = true AND role = 'application_engineer'`,
      [configuredId],
    );
    if (!configured) throw new Error("Configured candidate matcher AE is not an active Application Engineer");
    return configured.user_id;
  }
  const fallback = await queryOne<{ user_id: string }>(
    `SELECT p.user_id
       FROM profiles p
       LEFT JOIN applications a ON a.assigned_to_user_id = p.user_id
        AND a.ae_stage <> 'applied'
      WHERE p.is_active = true AND p.role = 'application_engineer'
      GROUP BY p.user_id, p.created_at
      ORDER BY COUNT(a.id), p.created_at, p.user_id
      LIMIT 1`,
  );
  return fallback?.user_id ?? null;
}

export async function runActiveCandidateJobMatcher(options: {
  mode: CandidateJobMatcherMode;
  triggerType: "scheduled" | "manual" | "recovery";
  actorUserId?: string | null;
  assignedToUserId?: string | null;
  runKey?: string;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  const assignedTo = options.mode === "ae_review"
    ? await resolveDefaultApplicationEngineer(options.assignedToUserId ?? process.env.CANDIDATE_MATCH_DEFAULT_AE_USER_ID)
    : null;
  if (options.mode === "ae_review" && !assignedTo) {
    throw new Error("AE review mode requires an active Application Engineer");
  }
  const runKey = options.runKey ?? (options.triggerType === "scheduled"
    ? `active-candidate-match:${dhakaDate(now)}`
    : `active-candidate-match:${options.triggerType}:${randomUUID()}`);
  const processingToken = randomUUID();
  const run = await queryOne<any>(
    `INSERT INTO candidate_job_match_runs
       (run_key, trigger_type, mode, assigned_to_user_id, config_snapshot, created_by, processing_token)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     ON CONFLICT (run_key) DO UPDATE
       SET processing_token = EXCLUDED.processing_token, updated_at = NOW(), error_message = NULL
       WHERE candidate_job_match_runs.status = 'running'
         AND candidate_job_match_runs.updated_at < NOW() - INTERVAL '30 minutes'
     RETURNING *`,
    [runKey, options.triggerType, options.mode, assignedTo, JSON.stringify({ freshnessDays: 7, tierAMin: 85, tierBMin: 70, maxRecommendationsPerCandidate: 50, requiresApprovedCurrentProfile: true }), options.actorUserId ?? null, processingToken],
  );
  if (!run) {
    const existing = await queryOne<any>("SELECT * FROM candidate_job_match_runs WHERE run_key = $1", [runKey]);
    if (existing) return existing;
    throw new Error("Could not create candidate matcher run");
  }
  if (run.status !== "running" || run.processing_token !== processingToken) return run;

  try {
    const profiles = await query<SearchProfileRow>(
      `SELECT p.id, p.candidate_id, p.base_resume_id, p.profile_version,
              p.approved_profile_version, p.resume_content_hash, p.keywords,
              p.keyword_states, p.additional_rules, br.content AS resume_content,
              c.name AS candidate_name, c.work_authorization, c.visa_status,
              c.preferred_locations
         FROM candidate_resume_search_profiles p
         JOIN base_resumes br ON br.id = p.base_resume_id AND br.candidate_id = p.candidate_id
         JOIN candidates c ON c.id = p.candidate_id
        WHERE c.status = 'active'
          AND p.review_status = 'approved'
          AND p.approved_profile_version = p.profile_version
        ORDER BY p.candidate_id, p.base_resume_id`,
    );
    const validProfiles: SearchProfileRow[] = [];
    for (const profile of profiles) {
      const hash = await sha256Hex(JSON.stringify(profile.resume_content ?? {}));
      if (profile.resume_content_hash && hash === profile.resume_content_hash) validProfiles.push(profile);
      else {
        await query(
          `UPDATE candidate_resume_search_profiles
              SET review_status = 'stale', approved_by = NULL, approved_at = NULL, updated_at = NOW()
            WHERE id = $1 AND review_status = 'approved'`,
          [profile.id],
        );
      }
    }
    const jobs = await query<RecentJobRow>(
      `SELECT id, title, company, location, description_text, raw_description,
              seniority_level, posted_at::text
         FROM jobs
        WHERE COALESCE(is_active, true) = true
          AND posted_at IS NOT NULL
          AND posted_at >= ($1::timestamptz - INTERVAL '7 days')::date
          AND posted_at <= $1::date
        ORDER BY posted_at DESC, id`,
      [now.toISOString()],
    );

    const byCandidate = new Map<string, SearchProfileRow[]>();
    for (const profile of validProfiles) {
      const rows = byCandidate.get(profile.candidate_id) ?? [];
      rows.push(profile);
      byCandidate.set(profile.candidate_id, rows);
    }
    let evaluated = 0;
    let recommended = 0;
    let rejected = 0;
    const cutoff = new Date(now.getTime() - 7 * 86_400_000);
    const decisionRows: Record<string, unknown>[] = [];

    for (const [candidateId, candidateProfiles] of byCandidate) {
      const winners: Array<{ profile: SearchProfileRow; job: RecentJobRow; evaluation: ReturnType<typeof evaluateCandidateJob> }> = [];
      for (const job of jobs) {
        const evaluations = candidateProfiles.map((profile) => {
          const terms = keywordSets(profile);
          const evaluation = evaluateCandidateJob(
            { workAuthorization: profile.work_authorization, visaStatus: profile.visa_status, preferredLocations: profile.preferred_locations, resumeText: resumeText(profile.resume_content) },
            { activeTerms: terms.active, dismissedTerms: terms.dismissed, additionalRules: profile.additional_rules },
            { title: job.title, company: job.company, location: job.location, description: job.description_text ?? job.raw_description ?? "", seniorityLevel: job.seniority_level, postedAt: job.posted_at },
            { now },
          );
          return { profile, job, evaluation };
        }).sort((a, b) => b.evaluation.score - a.evaluation.score
          || b.evaluation.matchedTerms.length - a.evaluation.matchedTerms.length
          || a.profile.base_resume_id.localeCompare(b.profile.base_resume_id));
        if (evaluations[0]) winners.push(evaluations[0]);
      }
      const selected = new Set(winners.filter((item) => item.evaluation.outcome === "recommended")
        .sort((a, b) => b.evaluation.score - a.evaluation.score || b.evaluation.matchedTerms.length - a.evaluation.matchedTerms.length || a.job.id.localeCompare(b.job.id))
        .slice(0, 50).map((item) => item.job.id));

      for (const winner of winners) {
        const isRecommended = winner.evaluation.outcome === "recommended" && selected.has(winner.job.id);
        const outcome = isRecommended ? "recommended" : "rejected";
        const reason = winner.evaluation.outcome === "recommended" && !selected.has(winner.job.id)
          ? "Below the candidate’s top 50 eligible recommendations"
          : winner.evaluation.reason;
        decisionRows.push({
          run_id: run.id, candidate_id: candidateId, base_resume_id: winner.profile.base_resume_id,
          profile_id: winner.profile.id, job_id: winner.job.id, score: winner.evaluation.score,
          tier: isRecommended ? winner.evaluation.tier : null, outcome, reason,
          matched_terms: winner.evaluation.matchedTerms, dismissed_term_hits: winner.evaluation.dismissedTermHits,
          score_breakdown: winner.evaluation.scoreBreakdown, hard_gates: winner.evaluation.hardGates,
          job_posted_at: winner.job.posted_at, freshness_cutoff: cutoff.toISOString(),
          review_status: isRecommended && options.mode === "ae_review" ? "pending" : "not_applicable",
          profile_version: winner.profile.profile_version,
        });
        evaluated += 1;
        if (isRecommended) recommended += 1; else rejected += 1;
      }
    }
    for (let offset = 0; offset < decisionRows.length; offset += 500) {
      const chunk = decisionRows.slice(offset, offset + 500);
      await query(
        `INSERT INTO candidate_job_match_decisions
           (run_id, candidate_id, base_resume_id, profile_id, job_id, score, tier,
            outcome, reason, matched_terms, dismissed_term_hits, score_breakdown,
            hard_gates, job_posted_at, freshness_cutoff, review_status, profile_version)
         SELECT x.run_id::uuid, x.candidate_id::uuid, x.base_resume_id::uuid,
                x.profile_id::uuid, x.job_id::uuid, x.score, x.tier, x.outcome,
                x.reason, x.matched_terms, x.dismissed_term_hits, x.score_breakdown,
                x.hard_gates, x.job_posted_at::timestamptz, x.freshness_cutoff::timestamptz,
                x.review_status, x.profile_version
           FROM jsonb_to_recordset($1::jsonb) AS x(
             run_id text, candidate_id text, base_resume_id text, profile_id text,
             job_id text, score integer, tier text, outcome text, reason text,
             matched_terms jsonb, dismissed_term_hits jsonb, score_breakdown jsonb,
             hard_gates jsonb, job_posted_at text, freshness_cutoff text,
             review_status text, profile_version integer)
         ON CONFLICT (run_id, candidate_id, job_id) DO NOTHING`,
        [JSON.stringify(chunk)],
      );
      await query(
        "UPDATE candidate_job_match_runs SET updated_at = NOW() WHERE id = $1 AND processing_token = $2",
        [run.id, processingToken],
      );
    }
    await query(
      `INSERT INTO candidate_job_match_rule_results (decision_id, rule_type, outcome, reason)
       SELECT d.id,
              CASE
                WHEN gate.reason ILIKE '%older than%' OR gate.reason ILIKE '%posting date%' THEN 'freshness'
                WHEN gate.reason ILIKE '%years%' THEN 'maximum_experience'
                WHEN gate.reason ILIKE '%citizen%' THEN 'citizenship'
                WHEN gate.reason ILIKE '%sponsor%' THEN 'work_authorization'
                WHEN gate.reason ILIKE '%clearance%' THEN 'security_clearance'
                WHEN gate.reason ILIKE '%description%' THEN 'job_description'
                WHEN gate.reason ILIKE '%additional rule%' THEN 'excluded_phrase'
                ELSE 'eligibility'
              END,
              'reject', gate.reason
         FROM candidate_job_match_decisions d
         CROSS JOIN LATERAL jsonb_array_elements_text(d.hard_gates) gate(reason)
        WHERE d.run_id = $1
       ON CONFLICT (decision_id, rule_type, reason) DO NOTHING`,
      [run.id],
    );
    await query(
      `INSERT INTO candidate_job_match_rule_results (decision_id, rule_type, outcome, reason)
       SELECT d.id, 'freshness', 'pass', 'Posting date is proven inside the seven-day matching window'
         FROM candidate_job_match_decisions d
        WHERE d.run_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(d.hard_gates) gate(reason)
             WHERE gate.reason ILIKE '%older than%' OR gate.reason ILIKE '%posting date%'
          )
       ON CONFLICT (decision_id, rule_type, reason) DO NOTHING`,
      [run.id],
    );
    return await queryOne<any>(
      `UPDATE candidate_job_match_runs
          SET status = 'succeeded', candidate_count = $2, job_count = $3,
              evaluated_count = $4, recommended_count = $5, rejected_count = $6,
              completed_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND processing_token = $7 RETURNING *`,
      [run.id, byCandidate.size, jobs.length, evaluated, recommended, rejected, processingToken],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query(
      `UPDATE candidate_job_match_runs SET status = 'failed', error_message = $2,
              completed_at = NOW(), updated_at = NOW() WHERE id = $1 AND processing_token = $3`,
      [run.id, message.slice(0, 2000), processingToken],
    );
    throw error;
  }
}

export async function approveCandidateJobMatch(options: {
  decisionId: string;
  actorUserId: string;
  actorName: string;
  assignedToUserId?: string | null;
  note?: string | null;
}) {
  const decision = await queryOne<any>(
    `SELECT d.*, br.content AS resume_content, p.resume_content_hash,
            p.review_status AS profile_review_status, p.profile_version AS current_profile_version,
            p.approved_profile_version, r.assigned_to_user_id
       FROM candidate_job_match_decisions d
       JOIN candidate_job_match_runs r ON r.id = d.run_id
       JOIN candidate_resume_search_profiles p ON p.id = d.profile_id
       JOIN base_resumes br ON br.id = d.base_resume_id
      WHERE d.id = $1`,
    [options.decisionId],
  );
  if (!decision) throw new Error("Match decision not found");
  if (decision.outcome !== "recommended"
    || !["pending", "approved"].includes(decision.review_status)
    || (decision.review_status === "approved" && !decision.application_id)) {
    throw new Error("Only pending recommendations or their existing application can be approved");
  }
  const currentHash = await sha256Hex(JSON.stringify(decision.resume_content ?? {}));
  if (decision.profile_review_status !== "approved" || decision.current_profile_version !== decision.profile_version
    || decision.approved_profile_version !== decision.profile_version || currentHash !== decision.resume_content_hash) {
    throw new Error("The approved resume search profile changed; run matching again before approval");
  }
  const assignedTo = await resolveDefaultApplicationEngineer(options.assignedToUserId ?? decision.assigned_to_user_id);
  if (!assignedTo) throw new Error("An active Application Engineer is required");
  const idempotencyKey = `candidate-job-match:${decision.id}`;
  const created = await queryOne<{ application_id: string }>(
    `WITH locked AS (
       SELECT d.id, d.candidate_id, d.job_id, d.base_resume_id, d.score, d.reason
         FROM candidate_job_match_decisions d
         JOIN jobs j ON j.id = d.job_id
        WHERE d.id = $1 AND d.review_status = 'pending' AND d.outcome = 'recommended'
          AND j.posted_at IS NOT NULL
          AND j.posted_at::timestamptz >= NOW() - INTERVAL '7 days'
          AND j.posted_at <= NOW()::date
        FOR UPDATE OF d
     ), inserted AS (
       INSERT INTO applications
         (candidate_id, job_id, status, source_type, base_resume_id,
          assigned_by_user_id, assigned_to_user_id, assignment_note, priority,
          review_status, ae_stage, application_stage, ae_stage_updated_at, ae_stage_updated_by_user_id,
          ae_stage_updated_by_name, resume_generation_status, next_action, notes,
          created_by, automation_idempotency_key, applied_at)
       SELECT candidate_id, job_id, 'assigned', 'base_resume', base_resume_id,
              $2::uuid, $3, 'Approved candidate-job match', 'normal', 'not_required',
              'in_ai_pipeline', 'in_ai_pipeline', NOW(), $2::uuid, $4, 'queued',
              'AI tailoring in progress',
              CONCAT('Matcher score ', score, '/100. ', reason), $2::text, $5, NULL
         FROM locked
       ON CONFLICT DO NOTHING
       RETURNING id
     ), event AS (
       INSERT INTO application_events (application_id, from_status, to_status, note)
       SELECT id, NULL, 'assigned', 'Created from an AE-approved candidate-job match'
         FROM inserted
       RETURNING id
     ), updated AS (
       UPDATE candidate_job_match_decisions d
          SET review_status = 'approved', reviewed_by_user_id = $2::uuid, reviewed_at = NOW(),
              review_note = $6, application_id = inserted.id, updated_at = NOW()
         FROM inserted
        WHERE d.id = $1
       RETURNING inserted.id AS application_id
     ) SELECT application_id FROM updated`,
    [options.decisionId, options.actorUserId, assignedTo, options.actorName, idempotencyKey, options.note ?? null],
  );
  if (!created) {
    const existing = await queryOne<{ application_id: string | null }>(
      "SELECT application_id FROM candidate_job_match_decisions WHERE id = $1",
      [options.decisionId],
    );
    if (existing?.application_id) {
      try {
        const workflow = await triggerAiWorkflowForApplication(existing.application_id, options.actorUserId, decision.base_resume_id);
        return { applicationId: existing.application_id, workflowStarted: workflow.started, workflow, idempotent: true };
      } catch (error) {
        await query(
          `UPDATE applications SET resume_generation_status = 'failed', resume_generation_error = $2
            WHERE id = $1`,
          [existing.application_id, (error instanceof Error ? error.message : String(error)).slice(0, 1000)],
        );
        throw error;
      }
    }
    throw new Error("Approval did not create an application; the job may already have an application or is no longer fresh");
  }
  try {
    const workflow = await triggerAiWorkflowForApplication(created.application_id, options.actorUserId, decision.base_resume_id);
    return { applicationId: created.application_id, workflowStarted: workflow.started, workflow, idempotent: false };
  } catch (error) {
    await query(
      `UPDATE applications SET resume_generation_status = 'failed', resume_generation_error = $2
        WHERE id = $1`,
      [created.application_id, (error instanceof Error ? error.message : String(error)).slice(0, 1000)],
    );
    throw error;
  }
}

export async function rejectCandidateJobMatch(options: { decisionId: string; actorUserId: string; note?: string | null }) {
  const row = await queryOne<any>(
    `UPDATE candidate_job_match_decisions
        SET review_status = 'rejected', reviewed_by_user_id = $2, reviewed_at = NOW(),
            review_note = $3, updated_at = NOW()
      WHERE id = $1 AND review_status = 'pending' AND outcome = 'recommended'
      RETURNING *`,
    [options.decisionId, options.actorUserId, options.note ?? null],
  );
  if (!row) throw new Error("Only pending recommendations can be rejected");
  return row;
}
