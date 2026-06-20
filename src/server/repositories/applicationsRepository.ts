// src/server/repositories/applicationsRepository.ts
// Data-access abstraction for the applications table.
// Implementation uses Supabase today; the interface is designed to be portable
// to Neon Postgres or any other SQL-compatible backend.
// Rule: new feature routes should call this repository, not supabase.from("applications") directly.

import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

export type ApplicationSourceType = "base_resume" | "original_resume" | "blank" | "manual" | null;

export interface ApplicationRow {
  id: string;
  candidate_id: string;
  job_id: string | null;
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
  status?: string;
  resume_url?: string | null;
  resume_filename?: string | null;
  resume_id?: string | null;
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
}

export interface ListApplicationsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  owner?: string;
  priority?: string;
  review?: string;
  view?: "all" | "mine" | "overdue" | "review";
  userId?: string;
  userEmail?: string | null;
  userDisplayName?: string | null;
  userRole?: string;
  pipelineStatuses?: string[];
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
  overdue: number;
  pendingReview: number;
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
  if (isNeon()) {
    return queryOne<ApplicationRow>(
      "SELECT * FROM applications WHERE id = $1",
      [id]
    );
  }
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as ApplicationRow;
}

/**
 * Create one or more applications.
 */
export async function createApplications(
  inputs: CreateApplicationInput[]
): Promise<ApplicationRow[]> {
  const rows = inputs.map((input) => ({
    candidate_id: input.candidate_id,
    job_id: input.job_id ?? null,
    status: input.status ?? "applied",
    resume_url: input.resume_url ?? null,
    resume_filename: input.resume_filename ?? null,
    resume_id: input.resume_id ?? null,
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

  if (isNeon()) {
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

  const { data, error } = await supabase.from("applications").insert(rows).select();
  if (error) throw new Error(error.message);
  return (data ?? []) as ApplicationRow[];
}

/**
 * Update an application by ID.
 */
export async function updateApplication(
  id: string,
  input: UpdateApplicationInput
): Promise<ApplicationRow> {
  if (isNeon()) {
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) updates[key] = value;
    }
    if (Object.keys(updates).length === 0) {
      throw new Error("No fields to update");
    }
    updates.updated_at = new Date().toISOString();

    const keys = Object.keys(updates);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = keys.map((k) => updates[k]) as (string | number | boolean | null | Date | object)[];
    values.push(id);
    const sql = `UPDATE applications SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`;
    const result = await queryOne<ApplicationRow>(sql, values);
    if (!result) throw new Error("Update failed");
    return result;
  }

  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) updates[key] = value;
  }
  if (Object.keys(updates).length === 0) {
    throw new Error("No fields to update");
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("applications")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ApplicationRow;
}

/**
 * Delete an application by ID.
 */
export async function deleteApplication(id: string): Promise<void> {
  if (isNeon()) {
    await execute("DELETE FROM applications WHERE id = $1", [id]);
    return;
  }
  const { error } = await supabase.from("applications").delete().eq("id", id);
  if (error) throw new Error(error.message);
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
  if (isNeon()) {
    const rows = await query<{ candidate_id: string }>(
      "SELECT candidate_id FROM applications WHERE job_id = $1 AND candidate_id = ANY($2)",
      [jobId, candidateIds]
    );
    return new Set(rows.map((r) => r.candidate_id));
  }
  const { data: existing } = await supabase
    .from("applications")
    .select("candidate_id")
    .eq("job_id", jobId)
    .in("candidate_id", candidateIds);
  return new Set((existing ?? []).map((r: any) => r.candidate_id as string));
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

  if (isNeon()) {
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
      ORDER BY a.created_at DESC
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

  let dbQuery = supabase
    .from("applications")
    .select("*, candidates(id, name, email), jobs(id, title, company)", { count: "exact" });

  if (search) {
    dbQuery = dbQuery.or(
      `candidates.name.ilike.%${search}%,candidates.email.ilike.%${search}%,jobs.title.ilike.%${search}%`
    );
  }

  const from = (page - 1) * pageSize;
  const { data, error, count } = await dbQuery
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) throw new Error(error.message);
  return {
    items: (data ?? []) as ApplicationRow[],
    total: count ?? 0,
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
  const owner = queryParams.owner || "";
  const priority = queryParams.priority || "";
  const review = queryParams.review || "";
  const view = queryParams.view || "all";

  if (isNeon()) {
    const offset = (page - 1) * pageSize;
    const searchParam = `%${search}%`;
    const statuses = queryParams.pipelineStatuses ?? ["assigned", "stacked", "in_progress"];
    const today = new Date().toISOString().slice(0, 10);

    const dataSql = `
      SELECT a.id, a.status, a.assigned_by, a.assigned_to, a.assigned_by_user_id, a.assigned_to_user_id,
        a.assignment_note, a.assignment_due_at, a.priority, a.review_status, a.review_note, a.reviewed_at,
        a.next_action, a.notes, a.applied_at, a.proof_url, a.proof_filename, a.proof_uploaded_at, a.source_type,
        jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone, 'resume_url', c.resume_url, 'resume_filename', c.resume_filename) as candidates,
        jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company, 'location', j.location, 'source_url', j.source_url, 'job_category', j.job_category, 'category_relevance_score', j.category_relevance_score) as jobs
      FROM applications a
      LEFT JOIN candidates c ON a.candidate_id = c.id
      LEFT JOIN jobs j ON a.job_id = j.id
      WHERE a.status = ANY($1)
        AND ($2 <> 'application_engineer' OR a.assigned_to_user_id IS NOT DISTINCT FROM $3 OR ($4 IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $4) OR ($5 IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $5))
        AND ($6 = '' OR c.name ILIKE $7 OR j.title ILIKE $7 OR j.company ILIKE $7)
        AND ($8 = '' OR a.status = $8)
        AND ($9 = '' OR a.assigned_to_user_id = $9 OR a.assigned_to = $9)
        AND ($10 = '' OR a.priority = $10)
        AND ($11 = '' OR a.review_status = $11)
        AND ($12 <> 'mine' OR $13 IS NULL OR a.assigned_to_user_id = $13)
        AND ($12 <> 'overdue' OR (a.assignment_due_at IS NOT NULL AND a.assignment_due_at <= $14))
        AND ($12 <> 'review' OR a.review_status = 'pending')
      ORDER BY a.assignment_due_at ASC NULLS LAST, a.applied_at DESC
      OFFSET $15 LIMIT $16
    `;
    const items = await query<ApplicationRow>(dataSql, [
      statuses,
      queryParams.userRole ?? "",
      queryParams.userId ?? null,
      queryParams.userEmail ?? null,
      queryParams.userDisplayName ?? null,
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
    ]);

    const countSql = `
      SELECT COUNT(*)::int as total
      FROM applications a
      LEFT JOIN candidates c ON a.candidate_id = c.id
      LEFT JOIN jobs j ON a.job_id = j.id
      WHERE a.status = ANY($1)
        AND ($2 <> 'application_engineer' OR a.assigned_to_user_id IS NOT DISTINCT FROM $3 OR ($4 IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $4) OR ($5 IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $5))
        AND ($6 = '' OR c.name ILIKE $7 OR j.title ILIKE $7 OR j.company ILIKE $7)
        AND ($8 = '' OR a.status = $8)
        AND ($9 = '' OR a.assigned_to_user_id = $9 OR a.assigned_to = $9)
        AND ($10 = '' OR a.priority = $10)
        AND ($11 = '' OR a.review_status = $11)
        AND ($12 <> 'mine' OR $13 IS NULL OR a.assigned_to_user_id = $13)
        AND ($12 <> 'overdue' OR (a.assignment_due_at IS NOT NULL AND a.assignment_due_at <= $14))
        AND ($12 <> 'review' OR a.review_status = 'pending')
    `;
    const countRow = await queryOne<{ total: number }>(countSql, [
      statuses,
      queryParams.userRole ?? "",
      queryParams.userId ?? null,
      queryParams.userEmail ?? null,
      queryParams.userDisplayName ?? null,
      search,
      searchParam,
      status,
      owner,
      priority,
      review,
      view,
      queryParams.userId ?? null,
      today,
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

  const selectString = `
    id,
    status,
    assigned_by,
    assigned_to,
    assigned_by_user_id,
    assigned_to_user_id,
    assignment_note,
    assignment_due_at,
    priority,
    review_status,
    review_note,
    reviewed_at,
    next_action,
    notes,
    applied_at,
    proof_url,
    proof_filename,
    proof_uploaded_at,
    source_type,
    candidates(id, name, email, phone, resume_url, resume_filename),
    jobs(id, title, company, location, source_url, job_category, category_relevance_score)
  `;

  let dbQuery = supabase
    .from("applications")
    .select(selectString, { count: "exact" })
    .in("status", queryParams.pipelineStatuses ?? ["assigned", "stacked", "in_progress"]);

  // Role-based ownership filter
  if (queryParams.userRole === "application_engineer") {
    const ownerFilters = [
      `assigned_to_user_id.eq.${queryParams.userId}`,
      queryParams.userEmail ? `assigned_to.eq.${queryParams.userEmail}` : "",
      queryParams.userDisplayName ? `assigned_to.eq.${queryParams.userDisplayName}` : "",
    ]
      .filter(Boolean)
      .join(",");
    dbQuery = dbQuery.or(ownerFilters);
  }

  if (search) {
    dbQuery = dbQuery.or(
      `candidates.name.ilike.%${search}%,jobs.title.ilike.%${search}%,jobs.company.ilike.%${search}%`
    );
  }
  if (status) dbQuery = dbQuery.eq("status", status);
  if (owner) {
    dbQuery = dbQuery.or(`assigned_to_user_id.eq.${owner},assigned_to.eq.${owner}`);
  }
  if (priority) dbQuery = dbQuery.eq("priority", priority);
  if (review) dbQuery = dbQuery.eq("review_status", review);

  const today = new Date().toISOString().slice(0, 10);
  if (view === "mine" && queryParams.userId) {
    dbQuery = dbQuery.eq("assigned_to_user_id", queryParams.userId);
  } else if (view === "overdue") {
    dbQuery = dbQuery.not("assignment_due_at", "is", null).lte("assignment_due_at", today);
  } else if (view === "review") {
    dbQuery = dbQuery.eq("review_status", "pending");
  }

  const from = (page - 1) * pageSize;
  const { data, error, count } = await dbQuery
    .order("assignment_due_at", { ascending: true, nullsFirst: false })
    .order("applied_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) throw new Error(error.message);

  // Stats
  const stats = await buildQueueStats(queryParams);

  return {
    items: (data ?? []) as ApplicationRow[],
    total: count ?? 0,
    page,
    pageSize,
    stats,
  };
}

async function buildQueueStats(params: ListApplicationsQuery): Promise<ApplicationQueueStats> {
  if (isNeon()) {
    const statuses = params.pipelineStatuses ?? ["assigned", "stacked", "in_progress"];
    const today = new Date().toISOString().slice(0, 10);

    const baseWhere = `
      status = ANY($1)
      AND ($2 <> 'application_engineer' OR assigned_to_user_id IS NOT DISTINCT FROM $3 OR ($4 IS NOT NULL AND assigned_to IS NOT DISTINCT FROM $4) OR ($5 IS NOT NULL AND assigned_to IS NOT DISTINCT FROM $5))
    `;

    const baseParams = [
      statuses,
      params.userRole ?? "",
      params.userId ?? null,
      params.userEmail ?? null,
      params.userDisplayName ?? null,
    ];

    const [allRow, mineRow, overdueRow, reviewRow] = await Promise.all([
      queryOne<{ total: number }>(
        `SELECT COUNT(*)::int as total FROM applications WHERE ${baseWhere}`,
        baseParams
      ),
      queryOne<{ total: number }>(
        `SELECT COUNT(*)::int as total FROM applications WHERE ${baseWhere} AND assigned_to_user_id = $6`,
        [...baseParams, params.userId ?? ""]
      ),
      queryOne<{ total: number }>(
        `SELECT COUNT(*)::int as total FROM applications WHERE ${baseWhere} AND assignment_due_at IS NOT NULL AND assignment_due_at <= $6`,
        [...baseParams, today]
      ),
      queryOne<{ total: number }>(
        `SELECT COUNT(*)::int as total FROM applications WHERE ${baseWhere} AND review_status = 'pending'`,
        baseParams
      ),
    ]);

    return {
      all: allRow?.total ?? 0,
      mine: mineRow?.total ?? 0,
      overdue: overdueRow?.total ?? 0,
      pendingReview: reviewRow?.total ?? 0,
    };
  }

  let q = supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .in("status", params.pipelineStatuses ?? ["assigned", "stacked", "in_progress"]);

  if (params.userRole === "application_engineer") {
    const ownerFilters = [
      `assigned_to_user_id.eq.${params.userId}`,
      params.userEmail ? `assigned_to.eq.${params.userEmail}` : "",
      params.userDisplayName ? `assigned_to.eq.${params.userDisplayName}` : "",
    ]
      .filter(Boolean)
      .join(",");
    q = q.or(ownerFilters);
  }

  const today = new Date().toISOString().slice(0, 10);
  const [allRes, mineRes, overdueRes, reviewRes] = await Promise.all([
    q,
    q.clone().eq("assigned_to_user_id", params.userId ?? ""),
    q.clone().not("assignment_due_at", "is", null).lte("assignment_due_at", today),
    q.clone().eq("review_status", "pending"),
  ]);

  return {
    all: allRes.count ?? 0,
    mine: mineRes.count ?? 0,
    overdue: overdueRes.count ?? 0,
    pendingReview: reviewRes.count ?? 0,
  };
}

/**
 * List applications for a specific candidate (candidate detail page).
 */
export async function listApplicationsForCandidate(
  candidateId: string
): Promise<ApplicationRow[]> {
  if (isNeon()) {
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

  const { data, error } = await supabase
    .from("applications")
    .select(
      `
      *,
      jobs(id, title, company, location, source_url, job_category, category_relevance_score),
      application_packets(*)
    `
    )
    .eq("candidate_id", candidateId)
    .order("applied_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ApplicationRow[];
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
  if (isNeon()) {
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

  const { data, error } = await supabase
    .from("application_events")
    .insert({
      application_id: input.application_id,
      from_status: input.from_status ?? null,
      to_status: input.to_status ?? null,
      note: input.note ?? null,
      created_by: input.created_by ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ApplicationEventRow;
}

/**
 * List events for a specific application.
 */
export async function listApplicationEvents(
  applicationId: string
): Promise<ApplicationEventRow[]> {
  if (isNeon()) {
    return query<ApplicationEventRow>(
      "SELECT * FROM application_events WHERE application_id = $1 ORDER BY created_at DESC",
      [applicationId]
    );
  }

  const { data, error } = await supabase
    .from("application_events")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ApplicationEventRow[];
}

// ───────────────────────────────────────────────────────────────
// Tool / digest helpers
// ───────────────────────────────────────────────────────────────

export async function listApplicationsForTool(
  opts: { status?: string | null; priority?: string | null; review_status?: string | null; search?: string | null; limit?: number } = {}
): Promise<any[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));
  if (isNeon()) {
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
  let dbQuery = supabase
    .from("applications")
    .select("id, status, priority, review_status, review_note, applied_at, follow_up_at, assigned_to, assignment_due_at, candidates(name, email), jobs(title, company)");
  if (opts.status) dbQuery = dbQuery.eq("status", opts.status);
  if (opts.priority) dbQuery = dbQuery.eq("priority", opts.priority);
  if (opts.review_status) dbQuery = dbQuery.eq("review_status", opts.review_status);
  const { data, error } = await dbQuery.order("applied_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function listAllApplicationsWithStatus(): Promise<{ status: string }[]> {
  if (isNeon()) {
    return query<{ status: string }>("SELECT status FROM applications");
  }
  const { data, error } = await supabase.from("applications").select("status");
  if (error) throw error;
  return (data ?? []) as { status: string }[];
}

export async function listOverdueApplications(since: string, limit = 20): Promise<any[]> {
  if (isNeon()) {
    return query<any>(
      `
      SELECT a.id, a.assignment_due_at, a.assigned_to,
        jsonb_build_object('name', c.name) as candidates,
        jsonb_build_object('title', j.title) as jobs
      FROM applications a
      LEFT JOIN candidates c ON a.candidate_id = c.id
      LEFT JOIN jobs j ON a.job_id = j.id
      WHERE a.status = ANY($1)
        AND a.assignment_due_at <= $2
        AND a.assignment_due_at IS NOT NULL
      ORDER BY a.assignment_due_at ASC
      LIMIT $3
      `,
      [["assigned", "stacked", "in_progress"], since, limit]
    );
  }
  const { data, error } = await supabase
    .from("applications")
    .select("id, assignment_due_at, assigned_to, candidates(name), jobs(title)")
    .in("status", ["assigned", "stacked", "in_progress"])
    .lte("assignment_due_at", since)
    .not("assignment_due_at", "is", null)
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function listApplicationsSince(since: string): Promise<any[]> {
  if (isNeon()) {
    return query<any>(
      "SELECT status, applied_at FROM applications WHERE applied_at >= $1",
      [since]
    );
  }
  const { data, error } = await supabase
    .from("applications")
    .select("status, applied_at")
    .gte("applied_at", since);
  if (error) throw error;
  return data ?? [];
}

export async function countApplicationsByStatus(statuses: string[]): Promise<number> {
  if (isNeon()) {
    const row = await queryOne<{ count: number }>(
      "SELECT COUNT(*)::int as count FROM applications WHERE status = ANY($1)",
      [statuses]
    );
    return row?.count ?? 0;
  }
  const { count, error } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .in("status", statuses);
  if (error) throw error;
  return count ?? 0;
}
