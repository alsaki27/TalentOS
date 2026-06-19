// src/server/repositories/applicationsRepository.ts
// Data-access abstraction for the applications table.
// Implementation uses Supabase today; the interface is designed to be portable
// to Neon Postgres or any other SQL-compatible backend.
// Rule: new feature routes should call this repository, not supabase.from("applications") directly.

import { supabase } from "@/lib/supabase";

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
  query: ListApplicationsQuery
): Promise<PaginatedApplicationsResult> {
  const page = Math.max(1, query.page ?? DEFAULT_PAGE);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));
  const search = (query.search || "").trim().replace(/[,()]/g, "");

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
  query: ListApplicationsQuery
): Promise<ApplicationQueueResult> {
  const page = Math.max(1, query.page ?? DEFAULT_PAGE);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));
  const search = (query.search || "").trim().replace(/[,()]/g, "");
  const status = query.status || "";
  const owner = query.owner || "";
  const priority = query.priority || "";
  const review = query.review || "";
  const view = query.view || "all";

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
    .in("status", query.pipelineStatuses ?? ["assigned", "stacked", "in_progress"]);

  // Role-based ownership filter
  if (query.userRole === "application_engineer") {
    const ownerFilters = [
      `assigned_to_user_id.eq.${query.userId}`,
      query.userEmail ? `assigned_to.eq.${query.userEmail}` : "",
      query.userDisplayName ? `assigned_to.eq.${query.userDisplayName}` : "",
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
  if (view === "mine" && query.userId) {
    dbQuery = dbQuery.eq("assigned_to_user_id", query.userId);
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
  const stats = await buildQueueStats(query);

  return {
    items: (data ?? []) as ApplicationRow[],
    total: count ?? 0,
    page,
    pageSize,
    stats,
  };
}

async function buildQueueStats(query: ListApplicationsQuery): Promise<ApplicationQueueStats> {
  let q = supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .in("status", query.pipelineStatuses ?? ["assigned", "stacked", "in_progress"]);

  if (query.userRole === "application_engineer") {
    const ownerFilters = [
      `assigned_to_user_id.eq.${query.userId}`,
      query.userEmail ? `assigned_to.eq.${query.userEmail}` : "",
      query.userDisplayName ? `assigned_to.eq.${query.userDisplayName}` : "",
    ]
      .filter(Boolean)
      .join(",");
    q = q.or(ownerFilters);
  }

  const today = new Date().toISOString().slice(0, 10);
  const [allRes, mineRes, overdueRes, reviewRes] = await Promise.all([
    q,
    q.clone().eq("assigned_to_user_id", query.userId ?? ""),
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
  const { data, error } = await supabase
    .from("application_events")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ApplicationEventRow[];
}
