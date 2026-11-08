// src/server/repositories/applicationsRepository.ts
// Data-access abstraction for the applications table.

import { parseQueueSort, type QueueSort } from "@/lib/applicationQueueFilters";
import { query, queryOne, execute } from "@/server/db/neon";

export type ApplicationSourceType = "base_resume" | "original_resume" | "blank" | "manual" | "email_confirmation" | "custom_interview" | null;

export interface ApplicationRow {
  id: string;
  candidate_id: string;
  job_id: string | null;
  app_number: number | null;
  status: string;
  resume_url: string | null;
  resume_filename: string | null;
  resume_id: string | null;
  source_type: ApplicationSourceType;
  follow_up_at: string | null;
  follow_up_source: string | null;
  follow_up_completed_at: string | null;
  next_action: string | null;
  notes: string | null;
  assigned_by: string | null;
  assigned_to: string | null;
  assigned_by_user_id: string | null;
  assigned_to_user_id: string | null;
  assignment_note: string | null;
  assignment_due_at: string | null;
  completed_at: string | null;
  priority: string | null;
  review_status: string | null;
  review_note: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  adhoc_job_data: Record<string, unknown> | null;
  adhoc_job_raw_text: string | null;
  proof_url: string | null;
  proof_filename: string | null;
  proof_uploaded_at: string | null;
  proof_uploaded_by_user_id: string | null;
  applied_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  ae_stage: string;
  application_stage?: string | null;
  application_stage_changed_at?: string | null;
  application_stage_changed_by_user_id?: string | null;
  application_stage_changed_by_name?: string | null;
  ae_review_pending_since?: string | null;
  ae_stage_updated_at: string | null;
  ae_stage_updated_by_user_id: string | null;
  ae_stage_updated_by_name: string | null;
  ae_reviewed_by_user_id: string | null;
  ae_reviewed_by_name: string | null;
  ae_reviewed_at: string | null;
  ae_applied_by_user_id: string | null;
  ae_applied_by_name: string | null;
  ae_applied_at: string | null;
  resume_generation_status?: string | null;
  resume_qc_status?: "qualified" | "doubt" | "unqualified" | null;
  resume_qc_changed_at?: string | null;
  resume_qc_changed_by_name?: string | null;
  resume_qc_eligible?: boolean;
  resume_qc_has_notes?: boolean;
}

export interface ApplicationEventRow {
  id: string;
  application_id: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  created_at: string | null;
  created_by: string | null;
}

export interface CreateApplicationInput {
  candidate_id: string;
  job_id?: string | null;
  app_number?: number | null;
  status?: string;
  resume_url?: string | null;
  resume_filename?: string | null;
  resume_id?: string | null;
  base_resume_id?: string | null;
  source_type?: ApplicationSourceType;
  follow_up_at?: string | null;
  next_action?: string | null;
  follow_up_source?: string | null;
  follow_up_created_at?: string | null;
  notes?: string | null;
  assigned_by?: string | null;
  assigned_to?: string | null;
  assigned_by_user_id?: string | null;
  assigned_to_user_id?: string | null;
  assignment_note?: string | null;
  assignment_due_at?: string | null;
  priority?: string | null;
  review_status?: string | null;
  adhoc_job_data?: Record<string, unknown> | null;
  adhoc_job_raw_text?: string | null;
  created_by?: string | null;
}

export interface UpdateApplicationInput {
  status?: string;
  application_stage?: string | null;
  application_stage_changed_at?: string | null;
  application_stage_changed_by_user_id?: string | null;
  application_stage_changed_by_name?: string | null;
  updated_at?: string | null;
  applied_at?: string | null;
  notes?: string | null;
  resume_url?: string | null;
  resume_filename?: string | null;
  resume_id?: string | null;
  source_type?: ApplicationSourceType;
  follow_up_at?: string | null;
  follow_up_source?: string | null;
  follow_up_completed_at?: string | null;
  next_action?: string | null;
  assigned_by?: string | null;
  assigned_to?: string | null;
  assigned_by_user_id?: string | null;
  assigned_to_user_id?: string | null;
  assignment_note?: string | null;
  assignment_due_at?: string | null;
  completed_at?: string | null;
  priority?: string | null;
  review_status?: string | null;
  review_note?: string | null;
  reviewed_by_user_id?: string | null;
  reviewed_at?: string | null;
  adhoc_job_data?: Record<string, unknown> | null;
  adhoc_job_raw_text?: string | null;
  proof_url?: string | null;
  proof_filename?: string | null;
  proof_uploaded_at?: string | null;
  proof_uploaded_by_user_id?: string | null;
  ae_stage?: string;
  ae_stage_updated_at?: string | null;
  ae_stage_updated_by_user_id?: string | null;
  ae_stage_updated_by_name?: string | null;
  ae_reviewed_by_user_id?: string | null;
  ae_reviewed_by_name?: string | null;
  ae_reviewed_at?: string | null;
  ae_applied_by_user_id?: string | null;
  ae_applied_by_name?: string | null;
  ae_applied_at?: string | null;
}

export interface ListApplicationsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  candidateId?: string;
  stage?: string;
  owner?: string;
  priority?: string;
  review?: string;
  fitScoreBand?: string;
  view?: string;
  userId?: string;
  userEmail?: string | null;
  userDisplayName?: string | null;
  userRole?: string;
  /** Statuses to hide from the queue. Defaults to DEFAULT_EXCLUDED_STATUSES
   *  (the terminal/archived ones). Pass [] to show every status - the
   *  caller does this whenever the AE has already narrowed results with an
   *  explicit Status or Stage selection, so that choice is always honored
   *  in full instead of being silently filtered further. */
  excludeStatuses?: string[];
  timeWindowMinutes?: number | null;
  sort?: QueueSort;
  sortDirection?: "asc" | "desc";
  /** Filters on jobs.work_mode: "remote" | "hybrid" | "onsite". Empty/omitted = no filter. */
  workMode?: string;
  /** Resume-QC filter, scoped to applications currently in AI or AE review. */
  qcStatus?: string;
}

export interface PaginatedApplicationsResult {
  items: ApplicationRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApplicationQueueStats {
  all: number;
  mine: number;
  pendingAeReview: number;
  pendingAeApplication: number;
  aiPipeline: number;
  failed: number;
}

export interface ApplicationQueueResult extends PaginatedApplicationsResult {
  stats: ApplicationQueueStats;
}

const QUALIFICATION_FIT_SCORE_BANDS = new Set(["8_10", "6_8", "4_6", "0_4", "no_score"]);

function qualificationFitScoreFilterValueSql(artifactAlias = "qf"): string {
  return `ROUND(COALESCE(
    CASE WHEN (${artifactAlias}.data->>'score') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${artifactAlias}.data->>'score')::numeric END,
    CASE WHEN (${artifactAlias}.data->'scoreRange'->>'min') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (${artifactAlias}.data->'scoreRange'->>'min')::numeric END
  ), 1)`;
}

function qualificationFitScoreBandPredicate(band: string, artifactAlias = "qf"): string {
  if (!QUALIFICATION_FIT_SCORE_BANDS.has(band)) return "";
  const score = qualificationFitScoreFilterValueSql(artifactAlias);
  switch (band) {
    case "8_10": return `${score} >= 8 AND ${score} <= 10`;
    case "6_8": return `${score} >= 6 AND ${score} < 8`;
    case "4_6": return `${score} >= 4 AND ${score} < 6`;
    case "0_4": return `${score} >= 0 AND ${score} < 4`;
    case "no_score": return `${score} IS NULL`;
    default: return "";
  }
}

// ───────────────────────────────────────────────────────────────
// Core CRUD
// ───────────────────────────────────────────────────────────────

/**
 * Find an application by its primary key.
 */
export async function findApplicationById(id: string): Promise<ApplicationRow | null> {
  return queryOne<ApplicationRow>(
    "SELECT * FROM applications WHERE id = $1",
    [id]
  );
}

/**
 * Generate a unique 5-digit application number (10000-99999).
 * Uses an atomic sequence on Neon; falls back to random collision-resistant on Supabase.
 */
async function generateAppNumbers(count: number): Promise<number[]> {
  const results = await queryOne<{ numbers: number[] }>(
    `SELECT ARRAY(SELECT nextval('applications_app_number_seq') FROM generate_series(1, $1)) AS numbers`,
    [count]
  );
  return results?.numbers ?? [];
}

/**
 * Create one or more applications.
 */
export async function createApplications(
  inputs: CreateApplicationInput[]
): Promise<ApplicationRow[]> {
  const appNumbers = await generateAppNumbers(inputs.length);
  const rows = inputs.map((input, i) => ({
    candidate_id: input.candidate_id,
    job_id: input.job_id ?? null,
    app_number: input.app_number ?? appNumbers[i] ?? null,
    status: input.status ?? "applied",
    application_stage: input.status === "applied" ? "applied" : input.status === "rejected" ? "rejected" : input.status === "withdrawn" ? "withdrawn" : input.status === "in_progress" || input.status === "assigned" || input.status === "stacked" ? "ready_for_review" : "in_ai_pipeline",
    ae_stage: input.status === "applied" ? "applied" : input.status === "rejected" ? "rejected" : input.status === "withdrawn" ? "withdrawn" : input.status === "in_progress" || input.status === "assigned" || input.status === "stacked" ? "ready_for_review" : "in_ai_pipeline",
    resume_url: input.resume_url ?? null,
    resume_filename: input.resume_filename ?? null,
    resume_id: input.resume_id ?? null,
    // The chosen base resume is recorded on the application itself, not just
    // handed to the AI workflow trigger - otherwise the AE's resume pick is
    // lost the moment the request ends and nothing downstream can show which
    // resume the ticket was actually logged against.
    base_resume_id: input.base_resume_id ?? null,
    source_type: input.source_type ?? "base_resume",
    follow_up_at: input.follow_up_at ?? null,
    next_action: input.next_action ?? null,
    follow_up_source: input.follow_up_source ?? null,
    follow_up_created_at: input.follow_up_created_at ?? null,
    notes: input.notes ?? null,
    assigned_by: input.assigned_by ?? null,
    assigned_to: input.assigned_to ?? null,
    assigned_by_user_id: input.assigned_by_user_id ?? null,
    assigned_to_user_id: input.assigned_to_user_id ?? null,
    assignment_note: input.assignment_note ?? null,
    assignment_due_at: input.assignment_due_at ?? null,
    priority: input.priority ?? "normal",
    review_status: input.review_status ?? "not_required",
    adhoc_job_data: input.adhoc_job_data ?? null,
    adhoc_job_raw_text: input.adhoc_job_raw_text ?? null,
    created_by: input.created_by ?? null,
  }));

  if (rows.length === 0) return [];
  const cols = Object.keys(rows[0]);
  const values: (string | number | boolean | null | Date | object)[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;
  for (const row of rows) {
    const rowPlaceholders: string[] = [];
    for (const col of cols) {
      rowPlaceholders.push(`$${paramIdx++}`);
      values.push((row as any)[col]);
    }
    placeholders.push(`(${rowPlaceholders.join(", ")})`);
  }
  const sql = `INSERT INTO applications (${cols.join(", ")}) VALUES ${placeholders.join(", ")} RETURNING *`;
  return query<ApplicationRow>(sql, values);
}

/**
 * Update an application by ID.
 */
export async function updateApplication(
  id: string,
  input: UpdateApplicationInput
): Promise<ApplicationRow> {
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) updates[key] = value;
  }
  if (Object.keys(updates).length === 0) {
    throw new Error("No fields to update");
  }

  const keys = Object.keys(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => updates[k]) as (string | number | boolean | null | Date | object)[];
  values.push(id);
  const sql = `UPDATE applications SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`;
  const result = await queryOne<ApplicationRow>(sql, values);
  if (!result) throw new Error("Update failed");
  return result;
}

/**
 * Auto-advance an application's AE hand-off stage from "in_ai_pipeline" to
 * "ready_for_review" once its AI workflow finishes - either the normal Final
 * Polish finalization path, or a manager's manual Kanban "move to completed"
 * override. Guarded on the current stage so it never clobbers a stage a human
 * has already moved forward (or back) manually. No-op if the row isn't still
 * sitting at "in_ai_pipeline".
 */
export async function advanceAeStageAfterAiCompletion(
  applicationId: string,
  actorName: string
): Promise<void> {
  await execute(
    `UPDATE applications
     SET ae_stage = 'ready_for_review',
         application_stage = 'ready_for_review',
         ae_stage_updated_at = NOW(),
         ae_stage_updated_by_user_id = NULL,
         ae_stage_updated_by_name = $2,
         application_stage_changed_at = NOW(),
         application_stage_changed_by_user_id = NULL,
         application_stage_changed_by_name = $2
     WHERE id = $1 AND ae_stage = 'in_ai_pipeline'`,
    [applicationId, actorName]
  );
  await execute(
    `INSERT INTO application_stage_history (application_id, from_stage, to_stage, changed_by_name, reason, source)
     VALUES ($1, 'in_ai_pipeline', 'ready_for_review', $2, 'AI workflow completed', 'ai_pipeline')
     ON CONFLICT DO NOTHING`,
    [applicationId, actorName]
  );
}

/**
 * Mirror image of advanceAeStageAfterAiCompletion, for the opposite
 * direction: reverts an application's AE hand-off stage back to
 * "in_ai_pipeline" when its AI workflow is deliberately restarted (retry,
 * restart, rerun, or regenerate) after already having reached
 * "ready_for_review".
 *
 * Without this, retrying/regenerating a workflow whose ticket had already
 * progressed left ae_stage stuck at "ready_for_review" while the workflow
 * itself was actively queued/running again - confirmed live as the exact
 * cause of the Application Queue's "AI Pipeline" tile and Stage filter
 * showing 0/none even while /resume-parsing-status correctly showed 13
 * workflows actively queued or running: all 13 were stuck at
 * ae_stage='ready_for_review' from before their retry.
 *
 * Guarded to only fire from "ready_for_review" - never touches a ticket an
 * AE has already moved further forward ("ready_for_application"/"applied"),
 * since that represents a deliberate human decision a background pipeline
 * restart should not undo. A no-op (nothing updated, no history row) for
 * any other current stage, including "in_ai_pipeline" itself.
 */
export async function revertAeStageForPipelineRestart(applicationId: string): Promise<void> {
  const actorName = "AI Pipeline Restart";
  const { rowCount } = await execute(
    `UPDATE applications
     SET ae_stage = 'in_ai_pipeline',
         application_stage = 'in_ai_pipeline',
         ae_stage_updated_at = NOW(),
         ae_stage_updated_by_user_id = NULL,
         ae_stage_updated_by_name = $2,
         application_stage_changed_at = NOW(),
         application_stage_changed_by_user_id = NULL,
         application_stage_changed_by_name = $2
     WHERE id = $1 AND ae_stage = 'ready_for_review'`,
    [applicationId, actorName]
  );
  if (rowCount > 0) {
    await execute(
      `INSERT INTO application_stage_history (application_id, from_stage, to_stage, changed_by_name, reason, source)
       VALUES ($1, 'ready_for_review', 'in_ai_pipeline', $2, 'AI workflow restarted', 'ai_pipeline')
       ON CONFLICT DO NOTHING`,
      [applicationId, actorName]
    );
  }
}

/**
 * Delete an application by ID, including the candidate+job resume state that
 * outlives the row itself.
 *
 * Deleting `applications` cascades away everything genuinely owned by this
 * one ticket - its AI workflows (and their stage runs/artifacts), packets,
 * events, comments, proofs, etc. But application_resume_versions.application_id
 * is ON DELETE SET NULL, and materializeFromBaseResume() never sets it in the
 * first place - a materialized/tailored resume is linked to the candidate+job
 * pair via target_job_id, not to one specific application. Left alone, that
 * row survives as an orphan, still status='active', still linked to
 * target_jobs(candidate_id, job_id). Confirmed live as a real bug: log a job,
 * pick base resume A, generate, delete the ticket, log the same job again
 * picking base resume B - the new tailored resume still came from A, because
 * triggerAiWorkflowForApplication's target_job-linked lookup found the
 * orphaned row from the deleted ticket before ever considering B. (That
 * lookup's priority order is also fixed separately so an explicit choice
 * always wins regardless - this is the other half: make the stale data stop
 * existing at all.)
 *
 * Once no other application references this exact (candidate_id, job_id)
 * pair, target_jobs itself is removed too - application_resume_versions and
 * job_keywords both cascade from it, so this clears every resume version
 * tied to that job for this candidate (this attempt's and any earlier
 * orphaned ones) in one step, guaranteeing the next attempt starts clean.
 */
export async function deleteApplication(id: string): Promise<void> {
  const app = await queryOne<{ job_id: string | null; candidate_id: string }>(
    "SELECT job_id, candidate_id FROM applications WHERE id = $1",
    [id]
  );
  if (!app) return;

  if (app.job_id) {
    await execute("DELETE FROM job_match_scores WHERE job_id = $1 AND candidate_id = $2", [app.job_id, app.candidate_id]);
  }

  await execute("DELETE FROM applications WHERE id = $1", [id]);

  if (app.job_id) {
    const stillReferenced = await queryOne<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM applications WHERE candidate_id = $1 AND job_id = $2) AS exists",
      [app.candidate_id, app.job_id]
    );
    if (!stillReferenced?.exists) {
      await execute(
        "DELETE FROM target_jobs WHERE candidate_id = $1 AND job_id = $2",
        [app.candidate_id, app.job_id]
      );
    }
  }
}

// ───────────────────────────────────────────────────────────────
// Deduplication helpers
// ───────────────────────────────────────────────────────────────

/**
 * Find existing candidate_ids for a given job_id.
 */
export async function findExistingCandidateIdsForJob(
  jobId: string,
  candidateIds: string[]
): Promise<Set<string>> {
  const rows = await query<{ candidate_id: string }>(
    "SELECT candidate_id FROM applications WHERE job_id::text = $1 AND candidate_id::text = ANY($2)",
    [jobId, candidateIds]
  );
  return new Set(rows.map((r) => r.candidate_id));
}

// ───────────────────────────────────────────────────────────────
// Listing / pagination
// ───────────────────────────────────────────────────────────────

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;

// The Application Queue previously showed a ticket only when `status` was
// exactly one of assigned/stacked/in_progress (an allowlist) - written
// before the AI email-triage pipeline started writing interview/offer/
// replied/rejected directly onto `status` (see applyEmailStageDecision in
// gmailSyncService.ts). Any ticket the AI moved to one of those newer
// statuses silently vanished from the queue even though it was still
// active, unresolved work - confirmed live: 85 tickets sitting at
// ae_stage='in_ai_pipeline' with status IN ('interview','replied') were
// invisible regardless of any filter selection. Flipped to a denylist of
// the genuinely terminal/archived statuses instead, so every other status
// - old or new - stays visible by default.
const DEFAULT_EXCLUDED_STATUSES = ["applied", "rejected", "withdrawn"];
const MAX_PAGE_SIZE = 200;

/**
 * List applications with pagination and search (general listing).
 */
export async function listApplications(
  queryParams: ListApplicationsQuery
): Promise<PaginatedApplicationsResult> {
  const page = Math.max(1, queryParams.page ?? DEFAULT_PAGE);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, queryParams.pageSize ?? DEFAULT_PAGE_SIZE)
  );
  const search = (queryParams.search || "").trim().replace(/[,()]/g, "");

  const offset = (page - 1) * pageSize;
  const searchParam = `%${search}%`;

  const dataSql = `
    SELECT a.*,
      jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email) as candidates,
      jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company) as jobs
    FROM applications a
    LEFT JOIN candidates c ON a.candidate_id = c.id
    LEFT JOIN jobs j ON a.job_id = j.id
    WHERE ($1 = '' OR c.name ILIKE $2 OR c.email ILIKE $2 OR j.title ILIKE $2)
    ORDER BY a.applied_at DESC
    OFFSET $3 LIMIT $4
  `;
  const items = await query<ApplicationRow>(dataSql, [
    search,
    searchParam,
    offset,
    pageSize,
  ]);

  const countSql = `
    SELECT COUNT(*)::int as total
    FROM applications a
    LEFT JOIN candidates c ON a.candidate_id = c.id
    LEFT JOIN jobs j ON a.job_id = j.id
    WHERE ($1 = '' OR c.name ILIKE $2 OR c.email ILIKE $2 OR j.title ILIKE $2)
  `;
  const countRow = await queryOne<{ total: number }>(countSql, [
    search,
    searchParam,
  ]);

  return {
    items,
    total: countRow?.total ?? 0,
    page,
    pageSize,
  };
}

/**
 * List application queue items (assigned/stacked/in_progress) with filters.
 */
export async function listApplicationQueue(
  queryParams: ListApplicationsQuery
): Promise<ApplicationQueueResult> {
  const page = Math.max(1, queryParams.page ?? DEFAULT_PAGE);
  const pageSize = Math.min(100, Math.max(1, queryParams.pageSize ?? DEFAULT_PAGE_SIZE));
  const rawSearch = (queryParams.search || "").trim().replace(/[,()]/g, "");
  // ID-prefixed searches: C#10057 (candidate), A#17395 (application/ticket),
  // J#19767 (job). The "#" is optional; a bare number matches any of the
  // three number columns. When an ID search matches, text search is
  // disabled so the two never combine into an empty result set.
  const idSearchMatch = /^([CJA])#?(\d+)$/i.exec(rawSearch);
  let search = rawSearch;
  let idSearchNumber: number | null = null;
  let idSearchKind = "";
  if (idSearchMatch) {
    search = "";
    idSearchNumber = parseInt(idSearchMatch[2], 10);
    const prefix = idSearchMatch[1].toUpperCase();
    idSearchKind = prefix === "C" ? "candidate" : prefix === "A" ? "app" : prefix === "J" ? "job" : "any";
  } else if (/^\d+$/.test(rawSearch)) {
    search = "";
    idSearchNumber = parseInt(rawSearch, 10);
    idSearchKind = "any";
  }
  if (idSearchNumber !== null && !Number.isSafeInteger(idSearchNumber)) idSearchNumber = -1;
  const requestedStage = queryParams.stage === "replied" ? "screening" : queryParams.stage || "";
  const aeStageFilter = ["in_ai_pipeline", "ready_for_review", "ready_for_application", "applied"].includes(requestedStage)
    ? requestedStage : "";
  const lifecycleStageFilter = ["screening", "interview", "offer", "rejected", "withdrawn"].includes(requestedStage)
    ? requestedStage : "";
  const requestedFitScoreBand = queryParams.fitScoreBand || "";
  const fitScoreBand = QUALIFICATION_FIT_SCORE_BANDS.has(requestedFitScoreBand) ? requestedFitScoreBand : "";
  const fitScorePredicate = qualificationFitScoreBandPredicate(fitScoreBand);
  const requestedQcStatus = queryParams.qcStatus || "";
  const qcStatus = ["not_checked", "qualified", "doubt", "unqualified"].includes(requestedQcStatus)
    ? requestedQcStatus
    : "";
  const fitScoreJoin = `
    LEFT JOIN LATERAL (
      SELECT data FROM application_ai_artifacts
      WHERE workflow_id = w.id AND automation_id = 'application_qualification_fit'
      ORDER BY created_at DESC, id DESC LIMIT 1
    ) qf ON true
  `;
  const sort = parseQueueSort(queryParams.sort);
  const sortDirection = queryParams.sortDirection === "asc" ? "ASC" : "DESC";
  // Email/status updates may advance the canonical stage without updating
  // legacy ae_stage. Those tickets are no longer waiting for AE review.
  const effectiveStage = "COALESCE(a.application_stage, a.ae_stage)";
  const dueOrder = "a.assignment_due_at ASC NULLS LAST, a.applied_at DESC NULLS LAST, a.id ASC";
  const orderBy = {
    ae_review_pending_newest: `CASE WHEN ${effectiveStage} = 'ready_for_review' THEN 0 ELSE 1 END,
      review_entry.pending_since DESC NULLS LAST, ${dueOrder}`,
    ae_review_pending: `CASE WHEN ${effectiveStage} = 'ready_for_review' THEN 0 ELSE 1 END,
      review_entry.pending_since ASC NULLS LAST, ${dueOrder}`,
    due: dueOrder,
    final_score: `workflow_score ${sortDirection} NULLS LAST, ${dueOrder}`,
    average_score: `average_score ${sortDirection} NULLS LAST, ${dueOrder}`,
  }[sort];
  const now = new Date();
  const minutes = queryParams.timeWindowMinutes;
  const activityCutoff = minutes && minutes > 0 && minutes <= 10080
    ? new Date(now.getTime() - minutes * 60_000).toISOString()
    : null;
  const lifecycleStage = `COALESCE(a.application_stage, CASE WHEN a.status = 'replied' THEN 'screening' ELSE a.status::text END)`;
  const excludeStatuses = queryParams.excludeStatuses ?? (
    lifecycleStageFilter || aeStageFilter === "applied" ? [] : DEFAULT_EXCLUDED_STATUSES
  );
  const params = [
    excludeStatuses, search, `%${search}%`, queryParams.owner || "", queryParams.priority || "", queryParams.review || "",
    queryParams.candidateId || "", aeStageFilter, idSearchNumber, idSearchKind, lifecycleStageFilter,
    queryParams.workMode || "", activityCutoff, queryParams.userId || null, now.toISOString().slice(0, 10),
  ];

  // Share filter predicates between the paginated rows and the counters.
  // The selected view determines which event the Activity window measures.
  const fromJoins = `
    FROM applications a
    LEFT JOIN candidates c ON a.candidate_id = c.id
    LEFT JOIN jobs j ON a.job_id = j.id
    CROSS JOIN (SELECT $13::timestamptz AS cutoff, $14::text AS viewer, $15::date AS today) settings
    LEFT JOIN LATERAL (
      SELECT id, status, current_stage, updated_at FROM application_ai_workflows
      WHERE application_id = a.id AND status IN ('queued','running','waiting','completed','failed')
      ORDER BY created_at DESC, id DESC LIMIT 1
    ) w ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        (SELECT h.changed_at FROM application_stage_history h
         WHERE h.application_id = a.id AND h.to_stage = 'ready_for_review'
           AND h.from_stage IS DISTINCT FROM h.to_stage
         ORDER BY h.changed_at DESC LIMIT 1),
        a.ae_stage_updated_at,
        CASE WHEN a.application_stage = 'ready_for_review' THEN a.application_stage_changed_at END,
        a.created_at
      ) AS pending_since
      WHERE ${effectiveStage} = 'ready_for_review'
    ) review_entry ON true
    LEFT JOIN application_resume_qc rq ON rq.application_id = a.id
  `;
  const commonWhere = `
    COALESCE(a.source_type, '') <> 'custom_interview'
    AND
    NOT (${lifecycleStage} = ANY($1))
    AND (($2 = '' AND $9::bigint IS NULL)
      OR ($2 <> '' AND (c.name ILIKE $3 OR j.title ILIKE $3 OR j.company ILIKE $3 OR j.location ILIKE $3))
      OR ($9::bigint IS NOT NULL AND (
        ($10 = 'any' AND (a.app_number = $9 OR c.candidate_number = $9 OR j.job_number = $9))
        OR ($10 = 'app' AND a.app_number = $9)
        OR ($10 = 'candidate' AND c.candidate_number = $9)
        OR ($10 = 'job' AND j.job_number = $9)
      )))
    AND ($4 = '' OR COALESCE(a.assigned_to_user_id::text, a.assigned_to) = $4)
    AND ($5 = '' OR a.priority = $5)
    AND ($6 = '' OR a.review_status = $6)
    AND ($7 = '' OR a.candidate_id::text = $7)
    AND ($8 = '' OR ${effectiveStage} = $8)
    AND ($11 = '' OR ${lifecycleStage} = $11)
    AND ($12 = '' OR j.work_mode = $12)
    ${qcStatus ? `AND ${effectiveStage} IN ('in_ai_pipeline', 'ready_for_review') AND ${qcStatus === "not_checked" ? "rq.application_id IS NULL" : "rq.status = $16"}` : ""}
    ${fitScorePredicate ? `AND (${fitScorePredicate})` : ""}
  `;
  const activity = (timestamp: string) => `(settings.cutoff IS NULL OR ${timestamp} >= settings.cutoff)`;
  const reviewActivity = activity("review_entry.pending_since");
  const defaultActivity = aeStageFilter === "ready_for_review" ? reviewActivity : activity("a.created_at");
  const viewPredicates = {
    all: defaultActivity,
    mine: `${defaultActivity} AND COALESCE(a.assigned_to_user_id::text, a.assigned_to) = settings.viewer`,
    ae_review: `${reviewActivity} AND ${effectiveStage} = 'ready_for_review'`,
    ae_application: `${defaultActivity} AND ${effectiveStage} = 'ready_for_application'`,
    workflow: `${defaultActivity} AND ${effectiveStage} = 'in_ai_pipeline'`,
    failed: `${activity("w.updated_at")} AND w.status = 'failed'`,
    overdue: `${defaultActivity} AND a.assignment_due_at <= settings.today`,
    review: `${defaultActivity} AND a.review_status = 'pending'`,
  };
  const requestedView = queryParams.view || "all";
  const view = Object.prototype.hasOwnProperty.call(viewPredicates, requestedView)
    ? requestedView as keyof typeof viewPredicates
    : "all";
  if (qcStatus && qcStatus !== "not_checked") params.push(qcStatus);
  const offsetParam = params.length + 1;
  const pageSizeParam = params.length + 2;

  const dataSql = `
    SELECT a.id, a.app_number, a.status, a.assigned_by, a.assigned_to, a.assigned_by_user_id, a.assigned_to_user_id,
      a.assignment_note, a.assignment_due_at, a.priority, a.review_status, a.review_note, a.reviewed_at,
      a.next_action, a.notes, a.applied_at, a.proof_url, a.proof_filename, a.proof_uploaded_at, a.source_type,
      a.ae_stage, a.ae_stage_updated_at, a.ae_stage_updated_by_user_id, a.ae_stage_updated_by_name,
      rq.status AS resume_qc_status, rq.changed_at AS resume_qc_changed_at,
      rq.changed_by_name AS resume_qc_changed_by_name,
      (${effectiveStage} IN ('in_ai_pipeline', 'ready_for_review')) AS resume_qc_eligible,
      EXISTS (SELECT 1 FROM application_resume_qc_notes rqn WHERE rqn.application_id = a.id) AS resume_qc_has_notes,
      review_entry.pending_since as ae_review_pending_since,
      a.ae_reviewed_by_user_id, a.ae_reviewed_by_name, a.ae_reviewed_at,
      a.ae_applied_by_user_id, a.ae_applied_by_name, a.ae_applied_at,
      jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone, 'resume_url', c.resume_url, 'resume_filename', c.resume_filename, 'candidate_number', c.candidate_number, 'avatar_url', c.avatar_url) as candidates,
      jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company, 'location', j.location, 'source_url', j.source_url, 'job_category', j.job_category, 'category_relevance_score', j.category_relevance_score, 'job_number', j.job_number, 'eligibility_restricted', j.eligibility_restricted, 'requires_citizenship', j.requires_citizenship, 'citizenship_countries', j.citizenship_countries, 'export_control_restricted', j.export_control_restricted, 'eligibility_restriction_evidence', j.eligibility_restriction_evidence) as jobs,
      w.status as workflow_status,
      w.id as workflow_id,
      w.current_stage as workflow_stage,
      CASE WHEN (fp.data->>'finalQaScore') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN CASE WHEN (fp.data->>'finalQaScore')::numeric BETWEEN 20 AND 100 THEN (fp.data->>'finalQaScore')::numeric / 10 ELSE (fp.data->>'finalQaScore')::numeric END END as workflow_score,
      CASE WHEN (hp.data->>'atsScore') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (hp.data->>'atsScore')::numeric END as hiring_panel_ats_score,
      CASE WHEN (hp.data->>'recruiterScore') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (hp.data->>'recruiterScore')::numeric END as hiring_panel_recruiter_score,
      CASE WHEN (hp.data->>'roleFitScore') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (hp.data->>'roleFitScore')::numeric END as hiring_panel_role_fit_score,
      CASE WHEN (hp.data->>'truthfulnessRisk') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN GREATEST(0, 10 - (hp.data->>'truthfulnessRisk')::numeric) END as hiring_panel_truth_score,
      CASE WHEN (qf.data->>'score') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (qf.data->>'score')::numeric END as qualification_fit_score,
      CASE WHEN (qf.data->'scoreRange'->>'min') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (qf.data->'scoreRange'->>'min')::numeric END as qualification_fit_score_min,
      CASE WHEN (qf.data->'scoreRange'->>'max') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (qf.data->'scoreRange'->>'max')::numeric END as qualification_fit_score_max,
      qf.data->>'status' as qualification_fit_status,
      CASE WHEN (qf.data->>'evidenceCoverage') ~ '^-?[0-9]+$' THEN (qf.data->>'evidenceCoverage')::int END as qualification_fit_evidence_coverage,
      CASE WHEN (qf.data->>'jobGroundingCoverage') ~ '^-?[0-9]+$' THEN (qf.data->>'jobGroundingCoverage')::int END as qualification_fit_job_grounding_coverage,
      score.average_score,
      a.tailored_resume_version_id as workflow_resume_version_id,
      rv.title as workflow_resume_title,
      rv.base_resume_id as base_resume_id,
      rv.one_page_fit_score,
      rv.page_fit_metrics,
      a.resume_generation_status
    ${fromJoins}
    ${fitScoreJoin}
    LEFT JOIN LATERAL (
      SELECT data FROM application_ai_artifacts
      WHERE workflow_id = w.id AND automation_id = 'application_hiring_panel'
      ORDER BY created_at DESC LIMIT 1
    ) hp ON true
    LEFT JOIN LATERAL (
      SELECT data FROM application_ai_artifacts
      WHERE workflow_id = w.id AND automation_id = 'application_final_polish'
      ORDER BY created_at DESC LIMIT 1
    ) fp ON true
    LEFT JOIN LATERAL (
      SELECT AVG(value)::numeric AS average_score
      FROM (VALUES
        (CASE WHEN (hp.data->>'atsScore') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (hp.data->>'atsScore')::numeric END),
        (CASE WHEN (hp.data->>'recruiterScore') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (hp.data->>'recruiterScore')::numeric END),
        (CASE WHEN (hp.data->>'roleFitScore') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (hp.data->>'roleFitScore')::numeric END),
        (CASE WHEN (hp.data->>'truthfulnessRisk') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN GREATEST(0, 10 - (hp.data->>'truthfulnessRisk')::numeric) END),
        (CASE WHEN (fp.data->>'finalQaScore') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN CASE WHEN (fp.data->>'finalQaScore')::numeric BETWEEN 20 AND 100 THEN (fp.data->>'finalQaScore')::numeric / 10 ELSE (fp.data->>'finalQaScore')::numeric END END)
      ) AS score_values(value)
      WHERE value IS NOT NULL
    ) score ON true
    LEFT JOIN application_resume_versions rv ON rv.id = a.tailored_resume_version_id
    WHERE ${commonWhere} AND (${viewPredicates[view]})
    ORDER BY ${orderBy}
    OFFSET ${offsetParam} LIMIT ${pageSizeParam}
  `;
  const statsSql = `
    SELECT ${Object.entries(viewPredicates).map(([name, predicate]) =>
      `COUNT(*) FILTER (WHERE ${predicate})::int AS "${name}"`
    ).join(",\n      ")}
    ${fromJoins}
    ${fitScoreBand ? fitScoreJoin : ""}
    WHERE ${commonWhere}
  `;
  const [items, counts] = await Promise.all([
    query<ApplicationRow>(dataSql, [...params, (page - 1) * pageSize, pageSize]),
    queryOne<Record<keyof typeof viewPredicates, number>>(statsSql, params),
  ]);
  return {
    items,
    total: counts?.[view] ?? 0,
    page,
    pageSize,
    stats: {
      all: counts?.all ?? 0,
      mine: counts?.mine ?? 0,
      pendingAeReview: counts?.ae_review ?? 0,
      pendingAeApplication: counts?.ae_application ?? 0,
      aiPipeline: counts?.workflow ?? 0,
      failed: counts?.failed ?? 0,
    },
  };
}

export function listApplicationQueueCandidates() {
  return query<{ id: string; name: string }>(
    `SELECT c.id, c.name
       FROM candidates c
       WHERE EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = c.id)
       ORDER BY c.name ASC, c.id ASC`
  );
}

/**
 * List applications for a specific candidate (candidate detail page).
 */
export async function listApplicationsForCandidate(
  candidateId: string
): Promise<ApplicationRow[]> {
  const sql = `
    SELECT a.*,
      jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company, 'location', j.location, 'source_url', j.source_url, 'job_category', j.job_category, 'category_relevance_score', j.category_relevance_score) as jobs,
      COALESCE(
        (SELECT jsonb_agg(ap.*) FROM application_packets ap WHERE ap.application_id = a.id),
        '[]'::jsonb
      ) as application_packets
    FROM applications a
    LEFT JOIN jobs j ON a.job_id = j.id
    WHERE a.candidate_id = $1
    ORDER BY a.applied_at DESC
  `;
  return query<ApplicationRow>(sql, [candidateId]);
}

// ───────────────────────────────────────────────────────────────
// Events / timeline
// ───────────────────────────────────────────────────────────────

export interface CreateApplicationEventInput {
  application_id: string;
  from_status?: string | null;
  to_status?: string | null;
  note?: string | null;
  created_by?: string | null;
}

/**
 * Create an application event (status change record).
 */
export async function createApplicationEvent(
  input: CreateApplicationEventInput
): Promise<ApplicationEventRow> {
  const sql = `
    INSERT INTO application_events (application_id, from_status, to_status, note, created_by)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  const result = await queryOne<ApplicationEventRow>(sql, [
    input.application_id,
    input.from_status ?? null,
    input.to_status ?? null,
    input.note ?? null,
    input.created_by ?? null,
  ]);
  if (!result) throw new Error("Failed to create application event");
  return result;
}

/**
 * List events for a specific application.
 */
export async function listApplicationEvents(
  applicationId: string
): Promise<ApplicationEventRow[]> {
  return query<ApplicationEventRow>(
    "SELECT * FROM application_events WHERE application_id = $1 ORDER BY created_at DESC",
    [applicationId]
  );
}

// ───────────────────────────────────────────────────────────────
// Tool / digest helpers
// ───────────────────────────────────────────────────────────────

export async function listApplicationsForTool(
  opts: { status?: string | null; priority?: string | null; review_status?: string | null; search?: string | null; limit?: number } = {}
): Promise<any[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));
  const conditions: string[] = [];
  const values: (string | number | null)[] = [];
  let idx = 1;
  if (opts.status) {
    conditions.push(`a.status = $${idx++}`);
    values.push(opts.status);
  }
  if (opts.priority) {
    conditions.push(`a.priority = $${idx++}`);
    values.push(opts.priority);
  }
  if (opts.review_status) {
    conditions.push(`a.review_status = $${idx++}`);
    values.push(opts.review_status);
  }
  if (opts.search) {
    conditions.push(`(c.name ILIKE $${idx++} OR j.title ILIKE $${idx++})`);
    values.push(`%${opts.search}%`, `%${opts.search}%`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `
    SELECT a.id, a.status, a.priority, a.review_status, a.review_note, a.applied_at, a.follow_up_at, a.assigned_to, a.assignment_due_at,
      jsonb_build_object('name', c.name, 'email', c.email) as candidates,
      jsonb_build_object('title', j.title, 'company', j.company) as jobs
    FROM applications a
    LEFT JOIN candidates c ON a.candidate_id = c.id
    LEFT JOIN jobs j ON a.job_id = j.id
    ${where}
    ORDER BY a.applied_at DESC
    LIMIT $${idx}
  `;
  values.push(limit);
  return query<any>(sql, values);
}

export async function listAllApplicationsWithStatus(): Promise<{ status: string }[]> {
  return query<{ status: string }>("SELECT status FROM applications");
}

export async function listOverdueApplications(limit = 20): Promise<any[]> {
  return query<any>(
    `
    SELECT a.id, a.assignment_due_at, a.assigned_to,
      jsonb_build_object('name', c.name) as candidates,
      jsonb_build_object('title', j.title) as jobs
    FROM applications a
    LEFT JOIN candidates c ON a.candidate_id = c.id
    LEFT JOIN jobs j ON a.job_id = j.id
    WHERE a.status = ANY($1)
      AND a.assignment_due_at <= CURRENT_DATE
      AND a.assignment_due_at IS NOT NULL
    ORDER BY a.assignment_due_at ASC
    LIMIT $2
    `,
    [["assigned", "stacked", "in_progress"], limit]
  );
}

export async function listApplicationsSince(since: string): Promise<any[]> {
  return query<any>(
    "SELECT status, applied_at FROM applications WHERE applied_at >= $1",
    [since]
  );
}

export async function countApplicationsByStatus(statuses: string[]): Promise<number> {
  const row = await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int as count FROM applications WHERE status = ANY($1)",
    [statuses]
  );
  return row?.count ?? 0;
}
