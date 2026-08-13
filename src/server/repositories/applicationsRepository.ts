// src/server/repositories/applicationsRepository.ts
// Data-access abstraction for the applications table.

import { query, queryOne, execute } from "@/server/db/neon";

export type ApplicationSourceType = "base_resume" | "original_resume" | "blank" | "manual" | "email_confirmation" | null;

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
  ae_stage_updated_at: string | null;
  ae_stage_updated_by_user_id: string | null;
  ae_stage_updated_by_name: string | null;
  ae_reviewed_by_user_id: string | null;
  ae_reviewed_by_name: string | null;
  ae_reviewed_at: string | null;
  ae_applied_by_user_id: string | null;
  ae_applied_by_name: string | null;
  ae_applied_at: string | null;
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
  status?: string;
  stage?: string;
  owner?: string;
  priority?: string;
  review?: string;
  view?: "all" | "mine" | "ae_review" | "ae_application";
  userId?: string;
  userEmail?: string | null;
  userDisplayName?: string | null;
  userRole?: string;
  pipelineStatuses?: string[];
  timeWindowHours?: number | null;
  sort?: "due" | "final_score" | "average_score";
  sortDirection?: "asc" | "desc";
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
}

export interface ApplicationQueueResult extends PaginatedApplicationsResult {
  stats: ApplicationQueueStats;
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
 * Delete an application by ID.
 */
export async function deleteApplication(id: string): Promise<void> {
  const app = await queryOne("SELECT job_id, candidate_id FROM applications WHERE id = $1", [id]);
  if (app) {
    await execute("DELETE FROM job_match_scores WHERE job_id = $1 AND candidate_id = $2", [app.job_id, app.candidate_id]);
  }
  await execute("DELETE FROM applications WHERE id = $1", [id]);
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
  const search = (queryParams.search || "").trim().replace(/[,()]/g, "");
  const status = queryParams.status || "";
  const requestedStage = queryParams.stage || "";
  const stage = new Set([
    "in_ai_pipeline",
    "ready_for_review",
    "ready_for_application",
    "applied",
  ]).has(requestedStage) ? requestedStage : "";
  const owner = queryParams.owner || "";
  const priority = queryParams.priority || "";
  const review = queryParams.review || "";
  const view = queryParams.view || "all";

  const offset = (page - 1) * pageSize;
  const searchParam = `%${search}%`;
  const statuses = queryParams.pipelineStatuses ?? ["assigned", "stacked", "in_progress"];
  const timeWindowHours = queryParams.timeWindowHours ?? null;
  const sort = queryParams.sort === "final_score" || queryParams.sort === "average_score"
    ? queryParams.sort
    : "due";
  const sortDirection = queryParams.sortDirection === "asc" ? "ASC" : "DESC";
  // Keep the original due-date ordering as the default. Score ordering is
  // deliberately whitelisted before it is interpolated into SQL.
  const orderBy = sort === "final_score"
    ? `workflow_score ${sortDirection} NULLS LAST, a.assignment_due_at ASC NULLS LAST, a.applied_at DESC`
    : sort === "average_score"
      ? `average_score ${sortDirection} NULLS LAST, a.assignment_due_at ASC NULLS LAST, a.applied_at DESC`
      : "a.assignment_due_at ASC NULLS LAST, a.applied_at DESC";
  const today = new Date().toISOString().slice(0, 10);

  const dataSql = `
    SELECT a.id, a.app_number, a.status, a.assigned_by, a.assigned_to, a.assigned_by_user_id, a.assigned_to_user_id,
      a.assignment_note, a.assignment_due_at, a.priority, a.review_status, a.review_note, a.reviewed_at,
      a.next_action, a.notes, a.applied_at, a.proof_url, a.proof_filename, a.proof_uploaded_at, a.source_type,
      a.ae_stage, a.ae_stage_updated_at, a.ae_stage_updated_by_user_id, a.ae_stage_updated_by_name,
      a.ae_reviewed_by_user_id, a.ae_reviewed_by_name, a.ae_reviewed_at,
      a.ae_applied_by_user_id, a.ae_applied_by_name, a.ae_applied_at,
      jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone, 'resume_url', c.resume_url, 'resume_filename', c.resume_filename, 'candidate_number', c.candidate_number, 'avatar_url', c.avatar_url) as candidates,
      jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company, 'location', j.location, 'source_url', j.source_url, 'job_category', j.job_category, 'category_relevance_score', j.category_relevance_score, 'job_number', j.job_number) as jobs,
      w.status as workflow_status,
      w.id as workflow_id,
      w.current_stage as workflow_stage,
      CASE WHEN (fp.data->>'finalQaScore') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (fp.data->>'finalQaScore')::numeric END as workflow_score,
      CASE WHEN (hp.data->>'atsScore') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (hp.data->>'atsScore')::numeric END as hiring_panel_ats_score,
      CASE WHEN (hp.data->>'recruiterScore') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (hp.data->>'recruiterScore')::numeric END as hiring_panel_recruiter_score,
      CASE WHEN (hp.data->>'roleFitScore') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (hp.data->>'roleFitScore')::numeric END as hiring_panel_role_fit_score,
      CASE WHEN (hp.data->>'truthfulnessRisk') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN GREATEST(0, 10 - (hp.data->>'truthfulnessRisk')::numeric) END as hiring_panel_truth_score,
      score.average_score,
      a.tailored_resume_version_id as workflow_resume_version_id,
      rv.title as workflow_resume_title,
      rv.base_resume_id as base_resume_id,
      a.resume_generation_status
    FROM applications a
    LEFT JOIN candidates c ON a.candidate_id = c.id
    LEFT JOIN jobs j ON a.job_id = j.id
    LEFT JOIN LATERAL (
      SELECT id, status, current_stage FROM application_ai_workflows
      WHERE application_id = a.id AND status IN ('queued','running','waiting','completed','failed')
      ORDER BY created_at DESC LIMIT 1
    ) w ON true
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
        (CASE WHEN (fp.data->>'finalQaScore') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (fp.data->>'finalQaScore')::numeric END)
      ) AS score_values(value)
      WHERE value IS NOT NULL
    ) score ON true
    LEFT JOIN application_resume_versions rv ON rv.id = a.tailored_resume_version_id
    WHERE a.status = ANY($1)
      -- Every role (including application_engineer) sees the whole queue regardless
      -- of assignment/owner - "mine" ($8) stays available as a voluntary filter.
      -- NOTE: the Neon HTTP driver (like plain pg) errors "could not determine
      -- data type of parameter" for any placeholder never referenced in the SQL
      -- text - unlike a raw pg.Client test, unused params can't just be left in
      -- the array. Renumbered end-to-end after dropping the old role-restriction
      -- params instead of leaving gaps.
      AND ($2 = '' OR c.name ILIKE $3 OR j.title ILIKE $3 OR j.company ILIKE $3)
      AND ($4 = '' OR a.status = $4)
      AND ($5 = '' OR a.assigned_to_user_id::text = $5 OR a.assigned_to = $5)
      AND ($6 = '' OR a.priority = $6)
      AND ($7 = '' OR a.review_status = $7)
      AND ($8 <> 'mine' OR $9::text IS NULL OR a.assigned_to_user_id::text = $9::text)
      AND ($8 <> 'overdue' OR (a.assignment_due_at IS NOT NULL AND a.assignment_due_at <= $10))
      AND ($8 <> 'review' OR a.review_status = 'pending')
      AND ($8 <> 'ae_review' OR a.ae_stage = 'ready_for_review')
      AND ($8 <> 'ae_application' OR a.ae_stage = 'ready_for_application')
      AND ($13 = '' OR a.candidate_id::text = $13)
      AND ($14 = '' OR a.ae_stage = $14)
      AND ($15::int IS NULL OR a.created_at >= NOW() - ($15::int * INTERVAL '1 hour'))
    ORDER BY ${orderBy}
    OFFSET $11 LIMIT $12
  `;
  const items = await query<ApplicationRow>(dataSql, [
    statuses,
    search,
    searchParam,
    status,
    owner,
    priority,
    review,
    view,
    queryParams.userId ?? null,
    today,
    offset,
    pageSize,
    queryParams.candidateId ?? "",
    stage,
    timeWindowHours,
  ]);

  const countSql = `
    SELECT COUNT(*)::int as total
    FROM applications a
    LEFT JOIN candidates c ON a.candidate_id = c.id
    LEFT JOIN jobs j ON a.job_id = j.id
    WHERE a.status = ANY($1)
      AND ($2 = '' OR c.name ILIKE $3 OR j.title ILIKE $3 OR j.company ILIKE $3)
      AND ($4 = '' OR a.status = $4)
      AND ($5 = '' OR a.assigned_to_user_id::text = $5 OR a.assigned_to = $5)
      AND ($6 = '' OR a.priority = $6)
      AND ($7 = '' OR a.review_status = $7)
      AND ($8 <> 'mine' OR $9::text IS NULL OR a.assigned_to_user_id::text = $9::text)
      AND ($8 <> 'overdue' OR (a.assignment_due_at IS NOT NULL AND a.assignment_due_at <= $10))
      AND ($8 <> 'review' OR a.review_status = 'pending')
      AND ($8 <> 'ae_review' OR a.ae_stage = 'ready_for_review')
      AND ($8 <> 'ae_application' OR a.ae_stage = 'ready_for_application')
      AND ($11 = '' OR a.candidate_id::text = $11)
      AND ($12 = '' OR a.ae_stage = $12)
      AND ($13::int IS NULL OR a.created_at >= NOW() - ($13::int * INTERVAL '1 hour'))
  `;
  const countRow = await queryOne<{ total: number }>(countSql, [
    statuses,
    search,
    searchParam,
    status,
    owner,
    priority,
    review,
    view,
    queryParams.userId ?? null,
    today,
    queryParams.candidateId ?? "",
    stage,
    timeWindowHours,
  ]);

  const stats = await buildQueueStats(queryParams);

  return {
    items,
    total: countRow?.total ?? 0,
    page,
    pageSize,
    stats,
  };
}

async function buildQueueStats(params: ListApplicationsQuery): Promise<ApplicationQueueStats> {
  const statuses = params.pipelineStatuses ?? ["assigned", "stacked", "in_progress"];
  // Stats mirror listApplicationQueue's visibility: every role sees the whole
  // queue, "mine" below stays a voluntary breakdown, not an access boundary.
  const baseWhere = `
    status = ANY($1)
  `;

  const baseParams = [statuses];

  const [allRow, mineRow, reviewRow, applicationRow, aiPipelineRow] = await Promise.all([
    queryOne<{ total: number }>(
      `SELECT COUNT(*)::int as total FROM applications WHERE ${baseWhere}`,
      baseParams
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*)::int as total FROM applications WHERE ${baseWhere} AND assigned_to_user_id::text = $2::text`,
      [...baseParams, params.userId ?? ""]
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*)::int as total FROM applications WHERE ${baseWhere} AND ae_stage = 'ready_for_review'`,
      baseParams
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*)::int as total FROM applications WHERE ${baseWhere} AND ae_stage = 'ready_for_application'`,
      baseParams
    ),
    queryOne<{ total: number }>(
      `SELECT COUNT(*)::int as total FROM applications WHERE ${baseWhere} AND ae_stage = 'in_ai_pipeline'`,
      baseParams
    ),
  ]);

  return {
    all: allRow?.total ?? 0,
    mine: mineRow?.total ?? 0,
    pendingAeReview: reviewRow?.total ?? 0,
    pendingAeApplication: applicationRow?.total ?? 0,
    aiPipeline: aiPipelineRow?.total ?? 0,
  };
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
