import { query, queryOne } from "@/server/db/neon";

export type CandidatePortalStatus = "Applied" | "Screening" | "Interview" | "Offer" | "Rejected";
export type CandidatePortalDateRange = "all" | "24h" | "7d" | "30d" | "90d" | "custom";
export type CandidatePortalResumeFilter = "all" | "ready" | "generating" | "unavailable";
export type CandidatePortalInterviewFilter = "all" | "upcoming" | "completed" | "cancelled" | "not_scheduled";
export type CandidatePortalSort = "submitted_at" | "updated_at" | "job_title" | "company_name" | "status" | "interview_at";

export interface CandidatePortalDashboardOptions {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  source?: string;
  dateRange?: CandidatePortalDateRange;
  dateFrom?: string;
  dateTo?: string;
  resumeStatus?: CandidatePortalResumeFilter;
  interviewStatus?: CandidatePortalInterviewFilter;
  needsAttention?: boolean;
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
    salary_min: number | null;
    salary_max: number | null;
    salary_currency: string | null;
    salary_period: string | null;
    salary_range: string | null;
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
  interview: { status: CandidatePortalInterviewFilter; scheduled_at: string | null };
  needs_attention: boolean;
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
  interview_at: "interview_at",
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
  interviews: { id: string; round_name: string; round_number: number; scheduled_at: string | null; duration_minutes: number | null; status: string; location: string | null; meeting_link: string | null; panel: string[] }[];
}

export interface CandidatePortalTrendPoint {
  bucket: string;
  count: number;
}

export interface CandidatePortalActionItem {
  id: string;
  type: "interview" | "follow_up";
  title: string;
  description: string;
  due_at: string | null;
  href: string;
}

export interface CandidatePortalInterview {
  id: string | null;
  application_id: string;
  job_title: string;
  company_name: string | null;
  location: string | null;
  round_name: string;
  round_number: number;
  scheduled_at: string | null;
  duration_minutes: number | null;
  status: "upcoming" | "completed" | "cancelled" | "not_scheduled";
  interview_status: string | null;
  meeting_link: string | null;
  panel: string[];
  visible_updates: { id: string; body: string; author: string; created_at: string | null }[];
}

export async function getCandidatePortalInterviews(candidateId: string): Promise<CandidatePortalInterview[]> {
  const rows = await query<any>(
    `SELECT
       s.id,
       a.id AS application_id,
       COALESCE(j.title, 'Application interview') AS job_title,
       j.company AS company_name,
       j.location,
       COALESCE(s.round_name, 'Interview') AS round_name,
       COALESCE(s.round_number, 1) AS round_number,
       s.scheduled_at,
       s.duration_minutes,
       s.status AS interview_status,
       s.meeting_link,
       COALESCE(array_agg(DISTINCT p.display_name) FILTER (WHERE p.display_name IS NOT NULL), '{}') AS panel,
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
           'id', update_row.id,
           'body', update_row.body,
           'author', update_row.author,
           'created_at', update_row.created_at
         ) ORDER BY update_row.created_at DESC)
         FROM (
           SELECT c.id, c.body, COALESCE(c.commenter_name, 'Skarion team') AS author, c.created_at
           FROM application_comments c
           WHERE c.application_id = a.id AND c.visible_to_candidate = true
           ORDER BY c.created_at DESC
           LIMIT 3
         ) update_row
       ), '[]'::jsonb) AS visible_updates
     FROM applications a
     LEFT JOIN jobs j ON j.id = a.job_id
     LEFT JOIN interview_schedules s ON s.application_id = a.id
     LEFT JOIN interview_panel_members pm ON pm.schedule_id = s.id
     LEFT JOIN profiles p ON p.user_id::text = pm.interviewer_id::text
     WHERE a.candidate_id = $1
       AND CASE WHEN a.ae_stage = 'applied' THEN 'applied' ELSE a.status END NOT IN ('assigned', 'stacked', 'in_progress')
       -- Guarded: without "AND a.status IN (...)" this could never be true
       -- once ae_stage='applied' (set once, at AE hand-off), so an
       -- email-detected interview would never appear here even after the
       -- AI pipeline moved the application's real status to 'interview'.
       AND (s.id IS NOT NULL OR (CASE WHEN a.ae_stage = 'applied' AND a.status IN ('assigned', 'stacked', 'in_progress') THEN 'applied' ELSE a.status END) = 'interview')
     GROUP BY s.id, a.id, j.title, j.company, j.location, s.round_name, s.round_number,
              s.scheduled_at, s.duration_minutes, s.status, s.meeting_link
     ORDER BY s.scheduled_at ASC NULLS LAST, s.round_number ASC, a.updated_at DESC
     LIMIT 100`,
    [candidateId],
  );

  return (rows ?? []).map((row: any) => {
    const rawStatus = String(row.interview_status || "scheduled").toLowerCase();
    const status = !row.id
      ? "not_scheduled"
      : rawStatus === "cancelled"
        ? "cancelled"
        : rawStatus === "completed" || (row.scheduled_at && new Date(row.scheduled_at).getTime() < Date.now())
          ? "completed"
          : "upcoming";
    return {
      id: row.id ?? null,
      application_id: row.application_id,
      job_title: row.job_title,
      company_name: row.company_name,
      location: row.location,
      round_name: row.round_name,
      round_number: Number(row.round_number ?? 1),
      scheduled_at: row.scheduled_at,
      duration_minutes: row.duration_minutes == null ? null : Number(row.duration_minutes),
      status,
      interview_status: row.interview_status,
      meeting_link: row.meeting_link,
      panel: Array.isArray(row.panel) ? row.panel : [],
      visible_updates: Array.isArray(row.visible_updates) ? row.visible_updates : [],
    };
  });
}

export async function getCandidatePortalApplicationDetail(candidateId: string, applicationId: string): Promise<CandidatePortalApplicationDetail | null> {
  const application = await queryOne<any>(
    `SELECT
       a.id,
       -- Guarded so a status the AI email-triage pipeline moved past
       -- 'applied' isn't masked back to "Applied" for display.
       CASE WHEN a.ae_stage = 'applied' AND a.status IN ('assigned', 'stacked', 'in_progress') THEN 'applied' ELSE a.status END AS status,
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
       j.salary_min,
       j.salary_max,
       j.salary_currency,
       j.salary_period,
       j.salary_range,
       COALESCE(j.apply_url, j.source_url) AS source_url,
       CASE WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL
                  AND rv.application_id = a.id
                  AND rv.candidate_id = a.candidate_id
                  AND (rv.status IN ('approved', 'final') OR packet.packet_status IN ('approved', 'sent')) THEN rv.id ELSE NULL END AS resume_id,
       CASE WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL
                  AND rv.application_id = a.id
                  AND rv.candidate_id = a.candidate_id
                  AND (rv.status IN ('approved', 'final') OR packet.packet_status IN ('approved', 'sent')) THEN 'ready'
            WHEN a.resume_generation_status IN ('queued', 'running', 'processing') THEN 'generating'
            ELSE 'unavailable' END AS resume_status,
       CASE WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL
                  AND rv.application_id = a.id
                  AND rv.candidate_id = a.candidate_id
                  AND (rv.status IN ('approved', 'final') OR packet.packet_status IN ('approved', 'sent')) THEN COALESCE(rv.title, 'Tailored resume') ELSE NULL END AS resume_title,
       CASE WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL
                  AND rv.application_id = a.id
                  AND rv.candidate_id = a.candidate_id
                  AND (rv.status IN ('approved', 'final') OR packet.packet_status IN ('approved', 'sent')) THEN rv.version_label ELSE NULL END AS resume_version_label,
       CASE WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL
                  AND rv.application_id = a.id
                  AND rv.candidate_id = a.candidate_id
                  AND (rv.status IN ('approved', 'final') OR packet.packet_status IN ('approved', 'sent')) THEN COALESCE(rv.updated_at, rv.created_at) ELSE NULL END AS resume_generated_at
     FROM applications a
     LEFT JOIN jobs j ON j.id = a.job_id
     LEFT JOIN application_resume_versions rv ON rv.id = a.tailored_resume_version_id
     LEFT JOIN application_packets packet ON packet.application_id = a.id AND packet.final_resume_version_id = rv.id
     WHERE a.id = $1
       AND a.candidate_id = $2
       AND CASE WHEN a.ae_stage = 'applied' THEN 'applied' ELSE a.status END NOT IN ('assigned', 'stacked', 'in_progress')`,
    [applicationId, candidateId],
  );

  if (!application) return null;

  const [comments, events, interviews] = await Promise.all([
    query<any>(
      `SELECT id, body, commenter_name, created_at
       FROM application_comments
       WHERE application_id = $1 AND visible_to_candidate = true
       ORDER BY created_at DESC LIMIT 100`,
      [applicationId],
    ),
    query<any>(
      `SELECT s.id, s.round_name, s.round_number, s.scheduled_at, s.duration_minutes, s.status, s.location, s.meeting_link,
              COALESCE(array_agg(DISTINCT p.display_name) FILTER (WHERE p.display_name IS NOT NULL), '{}') AS panel
       FROM interview_schedules s
       LEFT JOIN interview_panel_members pm ON pm.schedule_id = s.id
       LEFT JOIN profiles p ON p.user_id::text = pm.interviewer_id::text
       WHERE s.application_id = $1
       GROUP BY s.id
       ORDER BY s.scheduled_at ASC NULLS LAST, s.round_number ASC`,
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

  const timeline: CandidatePortalApplicationDetail["timeline"] = (events ?? []).map((event) => ({
    id: event.id,
    label: event.to_status === "applied" ? "Application submitted" : publicStatus(event.to_status).label,
    from_label: event.from_status ? publicStatus(event.from_status).label : null,
    to_label: publicStatus(event.to_status).label,
    created_at: event.created_at,
  }));

  if (application.resume_status === "ready" && application.resume_id) {
    timeline.push({
      id: `resume:${application.resume_id}`,
      label: "Tailored resume approved",
      from_label: null,
      to_label: "Resume ready",
      created_at: application.resume_generated_at,
    });
  }

  for (const interview of interviews ?? []) {
    const status = String(interview.status || "scheduled").toLowerCase();
    const label = status === "cancelled" ? "Interview cancelled" : status === "completed" ? "Interview completed" : "Interview scheduled";
    timeline.push({
      id: `interview:${interview.id}`,
      label: `${label}${interview.round_name ? ` · ${interview.round_name}` : ""}`,
      from_label: null,
      to_label: status,
      created_at: interview.scheduled_at,
    });
  }

  timeline.sort((left, right) => {
    const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
    const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
    return rightTime - leftTime;
  });

  return {
    id: application.id,
    status: application.status,
    public_status: publicStatus(application.status),
    submitted_at: application.submitted_at,
    updated_at: application.updated_at,
    job: application.job_id
      ? { id: application.job_id, title: application.job_title ?? "Unknown role", company: application.company_name, location: application.location, source: application.source, source_url: application.source_url, salary_min: application.salary_min == null ? null : Number(application.salary_min), salary_max: application.salary_max == null ? null : Number(application.salary_max), salary_currency: application.salary_currency, salary_period: application.salary_period, salary_range: application.salary_range }
      : null,
    resume: { id: application.resume_id, status: application.resume_status, title: application.resume_title, version_label: application.resume_version_label, generated_at: application.resume_generated_at },
    next_action: application.next_action,
    follow_up_at: application.follow_up_at,
    updates: (comments ?? []).map((comment) => ({ id: comment.id, body: comment.body, author: comment.commenter_name || "Skarion team", created_at: comment.created_at })),
    timeline,
    interviews: (interviews ?? []).map((interview) => ({
      id: interview.id,
      round_name: interview.round_name,
      round_number: Number(interview.round_number ?? 1),
      scheduled_at: interview.scheduled_at,
      duration_minutes: interview.duration_minutes == null ? null : Number(interview.duration_minutes),
      status: interview.status || "scheduled",
      location: interview.location,
      meeting_link: interview.meeting_link,
      panel: Array.isArray(interview.panel) ? interview.panel : [],
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
        -- Guarded so a status the AI email-triage pipeline moved past
        -- 'applied' isn't masked back to "Applied" for display.
        CASE WHEN a.ae_stage = 'applied' AND a.status IN ('assigned', 'stacked', 'in_progress') THEN 'applied' ELSE a.status END AS status,
        CASE WHEN a.ae_stage = 'applied'
          THEN COALESCE(a.applied_at, a.ae_applied_at, a.created_at)
          ELSE COALESCE(a.applied_at, a.created_at)
        END AS submitted_at,
        a.updated_at,
        a.next_action,
        a.follow_up_at,
        a.resume_generation_status,
        j.salary_min,
        j.salary_max,
        j.salary_currency,
        j.salary_period,
        j.salary_range,
        j.id AS job_id,
        j.title AS job_title,
        j.company AS company_name,
        j.location,
        j.source,
        COALESCE(j.apply_url, j.source_url) AS source_url,
        interview.id AS interview_id,
        interview.scheduled_at AS interview_at,
        CASE
          WHEN interview.id IS NULL THEN 'not_scheduled'
          WHEN LOWER(COALESCE(interview.status, 'scheduled')) = 'cancelled' THEN 'cancelled'
          WHEN LOWER(COALESCE(interview.status, 'scheduled')) = 'completed' OR interview.scheduled_at < NOW() THEN 'completed'
          ELSE 'upcoming'
        END AS interview_status,
        CASE
          WHEN (
            a.follow_up_at IS NOT NULL
            AND a.follow_up_at <= CURRENT_DATE + INTERVAL '7 days'
            AND CASE WHEN a.ae_stage = 'applied' THEN 'applied' ELSE a.status END NOT IN ('rejected', 'withdrawn')
          ) OR (
            interview.id IS NOT NULL
            AND LOWER(COALESCE(interview.status, 'scheduled')) NOT IN ('cancelled', 'completed')
            AND interview.scheduled_at >= NOW()
            AND interview.scheduled_at <= NOW() + INTERVAL '14 days'
          ) THEN TRUE ELSE FALSE
        END AS needs_attention,
        CASE
          WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL
               AND rv.application_id = a.id
               AND rv.candidate_id = a.candidate_id
               AND (rv.status IN ('approved', 'final') OR packet.packet_status IN ('approved', 'sent')) THEN rv.id
          ELSE NULL
        END AS resume_id,
        CASE
          WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL
               AND rv.application_id = a.id
               AND rv.candidate_id = a.candidate_id
               AND (rv.status IN ('approved', 'final') OR packet.packet_status IN ('approved', 'sent')) THEN 'ready'
          WHEN a.resume_generation_status IN ('queued', 'running', 'processing') THEN 'generating'
          ELSE 'unavailable'
        END AS resume_status,
        CASE
          WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL
               AND rv.application_id = a.id
               AND rv.candidate_id = a.candidate_id
               AND (rv.status IN ('approved', 'final') OR packet.packet_status IN ('approved', 'sent')) THEN COALESCE(rv.title, 'Tailored resume')
          ELSE NULL
        END AS resume_title,
        CASE
          WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL
               AND rv.application_id = a.id
               AND rv.candidate_id = a.candidate_id
               AND (rv.status IN ('approved', 'final') OR packet.packet_status IN ('approved', 'sent')) THEN rv.version_label
          ELSE NULL
        END AS resume_version_label,
        CASE
          WHEN a.resume_generation_status = 'ready' AND rv.id IS NOT NULL
               AND rv.application_id = a.id
               AND rv.candidate_id = a.candidate_id
               AND (rv.status IN ('approved', 'final') OR packet.packet_status IN ('approved', 'sent')) THEN COALESCE(rv.updated_at, rv.created_at)
          ELSE NULL
        END AS resume_generated_at,
        -- Same guard as the status column above - otherwise this feeds
        -- statusCounts/the status filter and would keep counting an
        -- email-detected interview/offer/rejection as "Applied".
        CASE WHEN a.ae_stage = 'applied' AND a.status IN ('assigned', 'stacked', 'in_progress') THEN 'applied' ELSE a.status END AS public_status_key
      FROM applications a
      LEFT JOIN jobs j ON j.id = a.job_id
      LEFT JOIN application_resume_versions rv ON rv.id = a.tailored_resume_version_id
      LEFT JOIN application_packets packet ON packet.application_id = a.id AND packet.final_resume_version_id = rv.id
      LEFT JOIN LATERAL (
        SELECT s.id, s.scheduled_at, s.status
        FROM interview_schedules s
        WHERE s.application_id = a.id
        ORDER BY s.scheduled_at ASC NULLS LAST, s.round_number ASC
        LIMIT 1
      ) interview ON TRUE
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
    const placeholder = `$${params.length + 1}`;
    conditions.push(`(job_title ILIKE ${placeholder} OR company_name ILIKE ${placeholder} OR location ILIKE ${placeholder})`);
  }

  const status = options.status as CandidatePortalStatus | undefined;
  if (status && STATUS_TO_DB_VALUES[status]) {
    params.push(STATUS_TO_DB_VALUES[status]);
    conditions.push(`public_status_key = ANY($${params.length + 1}::text[])`);
  }

  if (options.source?.trim()) {
    params.push(options.source.trim());
    conditions.push(`LOWER(COALESCE(source, 'unknown')) = LOWER($${params.length + 1})`);
  }

  if (options.resumeStatus && options.resumeStatus !== "all") {
    params.push(options.resumeStatus);
    conditions.push(`resume_status = $${params.length + 1}`);
  }

  if (options.interviewStatus && options.interviewStatus !== "all") {
    params.push(options.interviewStatus);
    conditions.push(`interview_status = $${params.length + 1}`);
  }

  if (options.needsAttention) conditions.push("needs_attention = TRUE");

  const range = ["all", "24h", "7d", "30d", "90d", "custom"].includes(options.dateRange ?? "all")
    ? options.dateRange ?? "all"
    : "all";
  if (range === "custom") {
    if (options.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(options.dateFrom)) {
      params.push(`${options.dateFrom}T00:00:00.000Z`);
      conditions.push(`submitted_at >= $${params.length + 1}::timestamptz`);
    }
    if (options.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(options.dateTo)) {
      params.push(`${options.dateTo}T23:59:59.999Z`);
      conditions.push(`submitted_at <= $${params.length + 1}::timestamptz`);
    }
  } else if (range !== "all") {
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

  const [countRow, rows, statusRows, sourceRows, totalRow, readyResumeRow, hourlyRows, dailyRows, monthlyRows, actionRows] = await Promise.all([
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
    ).catch(() => []),
    query<{ source: string | null; count: string }>(
      `${baseCte} SELECT COALESCE(source, 'unknown') AS source, COUNT(*)::text AS count FROM candidate_apps GROUP BY COALESCE(source, 'unknown') ORDER BY COUNT(*) DESC`,
      [candidateId],
    ),
    queryOne<{ count: string }>(`${baseCte} SELECT COUNT(*)::text AS count FROM candidate_apps`, [candidateId]),
    queryOne<{ count: string }>(`${baseCte} SELECT COUNT(*)::text AS count FROM candidate_apps WHERE resume_status = 'ready'`, [candidateId]),
    query<{ bucket: string; count: string }>(
      `${baseCte}, buckets AS (
         SELECT generate_series(date_trunc('hour', NOW() - INTERVAL '23 hours'), date_trunc('hour', NOW()), INTERVAL '1 hour') AS bucket
       )
       SELECT to_char(b.bucket, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS bucket, COUNT(a.id)::text AS count
       FROM buckets b
       LEFT JOIN candidate_apps a ON a.submitted_at >= b.bucket AND a.submitted_at < b.bucket + INTERVAL '1 hour'
       GROUP BY b.bucket ORDER BY b.bucket`,
      [candidateId],
    ),
    query<{ bucket: string; count: string }>(
      `${baseCte}, buckets AS (
         SELECT generate_series(date_trunc('day', NOW() - INTERVAL '6 days'), date_trunc('day', NOW()), INTERVAL '1 day') AS bucket
       )
       SELECT to_char(b.bucket, 'YYYY-MM-DD') AS bucket, COUNT(a.id)::text AS count
       FROM buckets b
       LEFT JOIN candidate_apps a ON a.submitted_at >= b.bucket AND a.submitted_at < b.bucket + INTERVAL '1 day'
       GROUP BY b.bucket ORDER BY b.bucket`,
      [candidateId],
    ),
    query<{ bucket: string; count: string }>(
      `${baseCte}, buckets AS (
         SELECT generate_series(date_trunc('month', NOW()) - INTERVAL '5 months', date_trunc('month', NOW()), INTERVAL '1 month') AS bucket
       )
       SELECT to_char(b.bucket, 'YYYY-MM') AS bucket, COUNT(a.id)::text AS count
       FROM buckets b
       LEFT JOIN candidate_apps a ON a.submitted_at >= b.bucket AND a.submitted_at < b.bucket + INTERVAL '1 month'
       GROUP BY b.bucket ORDER BY b.bucket`,
      [candidateId],
    ),
    query<any>(
      `SELECT * FROM (
         SELECT a.id, 'follow_up' AS type, 'Check in on your application' AS title,
                COALESCE(j.company, 'the employer') || ' · ' || COALESCE(j.title, 'your application') AS description,
                a.follow_up_at::timestamptz AS due_at
         FROM applications a
         LEFT JOIN jobs j ON j.id = a.job_id
         WHERE a.candidate_id = $1
           AND a.follow_up_at IS NOT NULL
           AND a.follow_up_at <= CURRENT_DATE + INTERVAL '7 days'
           AND CASE WHEN a.ae_stage = 'applied' THEN 'applied' ELSE a.status END NOT IN ('assigned', 'stacked', 'in_progress', 'rejected', 'withdrawn')
         UNION ALL
         SELECT a.id::text || ':' || s.id::text AS id, 'interview' AS type,
                'Prepare for ' || COALESCE(s.round_name, 'your interview') AS title,
                COALESCE(j.company, 'the employer') || ' · ' || COALESCE(j.title, 'your application') AS description,
                s.scheduled_at AS due_at
         FROM applications a
         JOIN interview_schedules s ON s.application_id = a.id
         LEFT JOIN jobs j ON j.id = a.job_id
         WHERE a.candidate_id = $1
           AND s.scheduled_at >= NOW()
           AND s.scheduled_at <= NOW() + INTERVAL '14 days'
           AND COALESCE(s.status, 'scheduled') NOT IN ('cancelled', 'completed')
       ) action_items
       ORDER BY due_at ASC NULLS LAST LIMIT 20`,
      [candidateId],
    ).catch(() => []),
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

  const trend = (rows: { bucket: string; count: string }[] | null | undefined): CandidatePortalTrendPoint[] =>
    (rows ?? []).map((row) => ({ bucket: row.bucket, count: Number(row.count ?? 0) }));

  const actionItems: CandidatePortalActionItem[] = (actionRows ?? []).map((row: any) => ({
    id: row.id,
    type: row.type === "interview" ? "interview" : "follow_up",
    title: row.title,
    description: row.description,
    due_at: row.due_at,
    href: `/portal/applications/${String(row.id).split(":")[0]}`,
  }));

  const applications: CandidatePortalApplication[] = rawRows.map((row: any) => ({
    id: row.id,
    status: row.status,
    public_status: publicStatus(row.status),
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
    job: row.job_id
      ? { id: row.job_id, title: row.job_title ?? "Unknown role", company: row.company_name, location: row.location, source: row.source, source_url: row.source_url, salary_min: row.salary_min == null ? null : Number(row.salary_min), salary_max: row.salary_max == null ? null : Number(row.salary_max), salary_currency: row.salary_currency, salary_period: row.salary_period, salary_range: row.salary_range }
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
    interview: { status: row.interview_status, scheduled_at: row.interview_at },
    needs_attention: Boolean(row.needs_attention),
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
    trend: { hourly24h: trend(hourlyRows), daily7d: trend(dailyRows), monthly6m: trend(monthlyRows) },
    actionItems,
  };
}
