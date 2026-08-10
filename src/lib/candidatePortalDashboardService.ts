import { query, queryOne } from "@/server/db/neon";

export type CandidatePortalStatus = "Applied" | "Screening" | "Interview" | "Offer" | "Rejected";
export type CandidatePortalDateRange = "all" | "24h" | "7d" | "30d" | "90d";
export type CandidatePortalResumeFilter = "all" | "ready" | "generating" | "unavailable";
export type CandidatePortalSort = "submitted_at" | "updated_at" | "job_title" | "company_name" | "status";

export interface CandidatePortalDashboardOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  source?: string;
  dateRange?: CandidatePortalDateRange;
  resumeStatus?: CandidatePortalResumeFilter;
  sort?: CandidatePortalSort;
  order?: "asc" | "desc";
}

export interface CandidatePortalApplication {
  id: string;
  status: string;
  public_status: { stage: string; label: string };
  submitted_at: string | null;
  updated_at: string | null;
  job: {
    id: string;
    title: string;
    company: string | null;
    location: string | null;
    source: string | null;
    source_url: string | null;
  } | null;
  resume: {
    id: string | null;
    status: CandidatePortalResumeFilter;
    title: string | null;
    version_label: string | null;
    generated_at: string | null;
  };
  next_action: string | null;
  follow_up_at: string | null;
}

const INTERNAL_PIPELINE_STATUSES = new Set(["assigned", "stacked", "in_progress"]);
const STATUS_TO_DB_VALUES: Record<CandidatePortalStatus, string[]> = {
  Applied: ["applied"],
  Screening: ["replied"],
  Interview: ["interview"],
  Offer: ["offer"],
  Rejected: ["rejected", "withdrawn"],
};

const STATUS_META: Record<string, { stage: string; label: string }> = {
  applied: { stage: "submitted", label: "Applied" },
  replied: { stage: "waiting", label: "Screening" },
  interview: { stage: "interview", label: "Interview" },
  offer: { stage: "offer", label: "Offer" },
  rejected: { stage: "closed", label: "Rejected" },
  withdrawn: { stage: "closed", label: "Rejected" },
};

const SORT_COLUMNS: Record<CandidatePortalSort, string> = {
  submitted_at: "submitted_at",
  updated_at: "updated_at",
  job_title: "job_title",
  company_name: "company_name",
  status: "public_status_key",
};

export function publicStatus(status: string) {
  return STATUS_META[status] ?? { stage: "submitted", label: "Applied" };
}

export interface CandidatePortalApplicationDetail {
  id: string;
  status: string;
  public_status: { stage: string; label: string };
  submitted_at: string | null;
  updated_at: string | null;
  job: CandidatePortalApplication["job"];
  resume: CandidatePortalApplication["resume"];
  next_action: string | null;
  follow_up_at: string | null;
  updates: { id: string; body: string; author: string; created_at: string | null }[];
  timeline: { id: string; label: string; from_label: string | null; to_label: string; created_at: string | null }[];
}

export async function getCandidatePortalApplicationDetail(candidateId: string, applicationId: string): Promise<CandidatePortalApplicationDetail | null> {
  const application = await queryOne<any>(
    `SELECT
       a.id,
       CASE WHEN a.ae_stage = 'applied' THEN 'applied' ELSE a.status END AS status,
       CASE WHEN a.ae_stage = 'applied'
         THEN COALESCE(a.applied_at, a.ae_applied_at, a.created_at)
         ELSE COALESCE(a.applied_at, a.created_at)
       END AS submitted_at,
       a.updated_at,
       a.next_action,
       a.follow_up_at,
       j.id AS job_id,
       j.title AS job_title,
       j.company AS company_name,
       j.location,
       j.source,
       COALESCE(j.apply_url, j.source_url) AS source_url,
       CASE WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL THEN rv.id ELSE NULL END AS resume_id,
       CASE WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL THEN 'ready'
            WHEN a.resume_generation_status IN ('queued', 'running', 'processing') THEN 'generating'
            ELSE 'unavailable' END AS resume_status,
       CASE WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL THEN COALESCE(rv.title, 'Tailored resume') ELSE NULL END AS resume_title,
       CASE WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL THEN rv.version_label ELSE NULL END AS resume_version_label,
       CASE WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL THEN COALESCE(rv.updated_at, rv.created_at) ELSE NULL END AS resume_generated_at
     FROM applications a
     LEFT JOIN jobs j ON j.id = a.job_id
     LEFT JOIN application_resume_versions rv ON rv.id = a.tailored_resume_version_id
     WHERE a.id = $1
       AND a.candidate_id = $2
       AND CASE WHEN a.ae_stage = 'applied' THEN 'applied' ELSE a.status END NOT IN ('assigned', 'stacked', 'in_progress')`,
    [applicationId, candidateId],
  );

  if (!application) return null;

  const [comments, events] = await Promise.all([
    query<any>(
      `SELECT id, body, commenter_name, created_at
       FROM application_comments
       WHERE application_id = $1 AND visible_to_candidate = true
       ORDER BY created_at DESC LIMIT 100`,
      [applicationId],
    ),
    query<any>(
      `SELECT id, from_status, to_status, created_at
       FROM application_events
       WHERE application_id = $1
         AND to_status NOT IN ('assigned', 'stacked', 'in_progress')
         AND COALESCE(from_status, '') NOT IN ('assigned', 'stacked', 'in_progress')
       ORDER BY created_at DESC LIMIT 100`,
      [applicationId],
    ),
  ]);

  return {
    id: application.id,
    status: application.status,
    public_status: publicStatus(application.status),
    submitted_at: application.submitted_at,
    updated_at: application.updated_at,
    job: application.job_id
      ? { id: application.job_id, title: application.job_title ?? "Unknown role", company: application.company_name, location: application.location, source: application.source, source_url: application.source_url }
      : null,
    resume: { id: application.resume_id, status: application.resume_status, title: application.resume_title, version_label: application.resume_version_label, generated_at: application.resume_generated_at },
    next_action: application.next_action,
    follow_up_at: application.follow_up_at,
    updates: (comments ?? []).map((comment) => ({ id: comment.id, body: comment.body, author: comment.commenter_name || "Skarion team", created_at: comment.created_at })),
    timeline: (events ?? []).map((event) => ({
      id: event.id,
      label: event.to_status === "applied" ? "Application submitted" : publicStatus(event.to_status).label,
      from_label: event.from_status ? publicStatus(event.from_status).label : null,
      to_label: publicStatus(event.to_status).label,
      created_at: event.created_at,
    })),
  };
}

function normalizePage(value: number | undefined, fallback: number, max: number) {
  return Math.min(max, Math.max(1, Number.isFinite(value) ? Math.floor(value as number) : fallback));
}

function normalizePageSize(value: number | undefined) {
  return Math.min(50, Math.max(5, Number.isFinite(value) ? Math.floor(value as number) : 10));
}

function buildBaseCte() {
  return `
    WITH candidate_apps AS (
      SELECT
        a.id,
        CASE WHEN a.ae_stage = 'applied' THEN 'applied' ELSE a.status END AS status,
        CASE WHEN a.ae_stage = 'applied'
          THEN COALESCE(a.applied_at, a.ae_applied_at, a.created_at)
          ELSE COALESCE(a.applied_at, a.created_at)
        END AS submitted_at,
        a.updated_at,
        a.next_action,
        a.follow_up_at,
        a.resume_generation_status,
        j.id AS job_id,
        j.title AS job_title,
        j.company AS company_name,
        j.location,
        j.source,
        COALESCE(j.apply_url, j.source_url) AS source_url,
        CASE
          WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL THEN rv.id
          ELSE NULL
        END AS resume_id,
        CASE
          WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL THEN 'ready'
          WHEN a.resume_generation_status IN ('queued', 'running', 'processing') THEN 'generating'
          ELSE 'unavailable'
        END AS resume_status,
        CASE
          WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL THEN COALESCE(rv.title, 'Tailored resume')
          ELSE NULL
        END AS resume_title,
        CASE
          WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL THEN rv.version_label
          ELSE NULL
        END AS resume_version_label,
        CASE
          WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL THEN COALESCE(rv.updated_at, rv.created_at)
          ELSE NULL
        END AS resume_generated_at,
        CASE WHEN a.ae_stage = 'applied' THEN 'applied' ELSE a.status END AS public_status_key
      FROM applications a
      LEFT JOIN jobs j ON j.id = a.job_id
      LEFT JOIN application_resume_versions rv ON rv.id = a.tailored_resume_version_id
      WHERE a.candidate_id = $1
        AND CASE WHEN a.ae_stage = 'applied' THEN 'applied' ELSE a.status END NOT IN ('assigned', 'stacked', 'in_progress')
    )
  `;
}

function buildFilters(options: CandidatePortalDashboardOptions) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.search?.trim()) {
    params.push(`%${options.search.trim()}%`);
    const placeholder = `$${params.length + 2}`;
    conditions.push(`(job_title ILIKE ${placeholder} OR company_name ILIKE ${placeholder} OR location ILIKE ${placeholder})`);
  }

  const status = options.status as CandidatePortalStatus | undefined;
  if (status && STATUS_TO_DB_VALUES[status]) {
    params.push(STATUS_TO_DB_VALUES[status]);
    conditions.push(`public_status_key = ANY($${params.length + 2}::text[])`);
  }

  if (options.source?.trim()) {
    params.push(options.source.trim());
    conditions.push(`LOWER(COALESCE(source, 'unknown')) = LOWER($${params.length + 2})`);
  }

  if (options.resumeStatus && options.resumeStatus !== "all") {
    params.push(options.resumeStatus);
    conditions.push(`resume_status = $${params.length + 2}`);
  }

  const range = ["all", "24h", "7d", "30d", "90d"].includes(options.dateRange ?? "all")
    ? options.dateRange ?? "all"
    : "all";
  if (range !== "all") {
    const interval = range === "24h" ? "24 hours" : range === "7d" ? "7 days" : range === "30d" ? "30 days" : "90 days";
    conditions.push(`submitted_at >= NOW() - INTERVAL '${interval}'`);
  }

  return {
    sql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export async function buildCandidatePortalDashboardPage(
  candidateId: string,
  candidateName: string,
  options: CandidatePortalDashboardOptions = {},
) {
  const pageSize = normalizePageSize(options.pageSize);
  const requestedPage = normalizePage(options.page, 1, Number.MAX_SAFE_INTEGER);
  const sort = options.sort && SORT_COLUMNS[options.sort] ? options.sort : "submitted_at";
  const order = options.order === "asc" ? "ASC" : "DESC";
  const baseCte = buildBaseCte();
  const filter = buildFilters(options);
  const filterParams = [candidateId, ...filter.params];
  const filterSql = filter.sql;
  const sortColumn = SORT_COLUMNS[sort];

  const [countRow, rows, statusRows, sourceRows, totalRow, readyResumeRow] = await Promise.all([
    queryOne<{ count: string }>(`${baseCte} SELECT COUNT(*)::text AS count FROM candidate_apps ${filterSql}`, filterParams),
    query<any>(
      `${baseCte}
       SELECT * FROM candidate_apps ${filterSql}
       ORDER BY ${sortColumn} ${order} NULLS LAST, id DESC
       OFFSET $${filterParams.length + 1} LIMIT $${filterParams.length + 2}`,
      [...filterParams, (requestedPage - 1) * pageSize, pageSize],
    ),
    query<{ public_status_key: string; count: string }>(
      `${baseCte} SELECT public_status_key, COUNT(*)::text AS count FROM candidate_apps GROUP BY public_status_key`,
      [candidateId],
    ),
    query<{ source: string | null; count: string }>(
      `${baseCte} SELECT COALESCE(source, 'unknown') AS source, COUNT(*)::text AS count FROM candidate_apps GROUP BY COALESCE(source, 'unknown') ORDER BY COUNT(*) DESC`,
      [candidateId],
    ),
    queryOne<{ count: string }>(`${baseCte} SELECT COUNT(*)::text AS count FROM candidate_apps`, [candidateId]),
    queryOne<{ count: string }>(`${baseCte} SELECT COUNT(*)::text AS count FROM candidate_apps WHERE resume_status = 'ready'`, [candidateId]),
  ]);

  const total = Number(countRow?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const rawRows = page === requestedPage
    ? rows ?? []
    : await query<any>(
        `${baseCte}
         SELECT * FROM candidate_apps ${filterSql}
         ORDER BY ${sortColumn} ${order} NULLS LAST, id DESC
         OFFSET $${filterParams.length + 1} LIMIT $${filterParams.length + 2}`,
        [...filterParams, (page - 1) * pageSize, pageSize],
      );

  const statusCounts: Record<string, number> = { Applied: 0, Screening: 0, Interview: 0, Offer: 0, Rejected: 0 };
  for (const row of statusRows ?? []) {
    const label = publicStatus(row.public_status_key).label;
    statusCounts[label] = (statusCounts[label] ?? 0) + Number(row.count ?? 0);
  }

  const sourceCounts: Record<string, number> = {};
  for (const row of sourceRows ?? []) sourceCounts[row.source ?? "unknown"] = Number(row.count ?? 0);

  const applications: CandidatePortalApplication[] = rawRows.map((row: any) => ({
    id: row.id,
    status: row.status,
    public_status: publicStatus(row.status),
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
    job: row.job_id
      ? { id: row.job_id, title: row.job_title ?? "Unknown role", company: row.company_name, location: row.location, source: row.source, source_url: row.source_url }
      : null,
    resume: {
      id: row.resume_id,
      status: row.resume_status,
      title: row.resume_title,
      version_label: row.resume_version_label,
      generated_at: row.resume_generated_at,
    },
    next_action: row.next_action,
    follow_up_at: row.follow_up_at,
  }));

  return {
    name: candidateName,
    summary: {
      totalApplications: Number(totalRow?.count ?? 0),
      activeApplications: statusCounts.Applied + statusCounts.Screening + statusCounts.Interview,
      interviews: statusCounts.Interview,
      offers: statusCounts.Offer,
      resumesReady: Number(readyResumeRow?.count ?? 0),
    },
    applications,
    total,
    page,
    pageSize,
    totalPages,
    statusCounts,
    sourceCounts,
  };
}
