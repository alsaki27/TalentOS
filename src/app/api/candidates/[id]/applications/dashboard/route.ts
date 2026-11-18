import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext, ALL_USER_ROLES } from "@/lib/auth";
import { query } from "@/server/db/neon";
import { applicationDashboardStatusGroup, emptyStatusCounts } from "@/lib/applicationDisplayStatus";

export const dynamic = "force-dynamic";

interface DashboardRow {
  application_id: string;
  status: string;
  application_stage: string | null;
  source_type: string | null;
  ae_stage: string;
  priority: string | null;
  applied_at: string | null;
  follow_up_at: string | null;
  next_action: string | null;
  job_id: string;
  job_title: string;
  company_name: string;
  company_website: string | null;
  job_source: string;
  source_url: string | null;
  location: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  eligibility_restricted: boolean | null;
  requires_citizenship: boolean | null;
  citizenship_countries: string[] | null;
  export_control_restricted: boolean | null;
  eligibility_restriction_evidence: string | null;
  fit_score: number | null;
  recommendation: string | null;
  tailored_resume_version_id: string | null;
  sharepoint_resume_url: string | null;
  resume_id: string | null;
  application_resume_url: string | null;
  application_resume_filename: string | null;
  interview_scheduled_at: string | null;
  interview_time_zone: string | null;
  interview_format: "online" | "onsite" | null;
  interview_stages: { round_number: number; scheduled_at: string | null; time_zone: string | null; interview_format: "online" | "onsite" | null; status: string; notes: string | null; rescheduled_at: string | null }[] | null;
  candidate_timezone: string | null;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  var currentUser = await getCurrentUserContext();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!ALL_USER_ROLES.includes(currentUser.profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  var candidateId = params.id;
  var url = new URL(req.url);
  var search = (url.searchParams.get("search") || "").trim().toLowerCase();
  var statusGroup = url.searchParams.get("statusGroup") || "";
  var source = url.searchParams.get("source") || "";
  var sourceType = url.searchParams.get("sourceType") || "";
  var matchLevel = url.searchParams.get("matchLevel") || "";
  var page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  var pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "25", 10) || 25));
  var sort = url.searchParams.get("sort") || "applied_at";
  var order = url.searchParams.get("order") || "desc";

  var allowedSort = ["company_name", "job_title", "applied_at", "fit_score", "status"];
  if (allowedSort.indexOf(sort) === -1) sort = "applied_at";
  if (order !== "asc" && order !== "desc") order = "desc";

  try {
    // Fetch all rows for counts (unfiltered by search/status/source — just the candidate)
    var allRows = await query<DashboardRow>(
      `SELECT
        a.id AS application_id,
        a.source_type,
        -- This table is editable from the candidate page. The value selected
        -- in its status dropdown is the source of truth for this view; do not
        -- mask it back to "applied" from the historical AE hand-off mirror.
        a.status AS status,
        a.application_stage,
        a.ae_stage,
        a.priority,
        COALESCE(a.applied_at, CASE WHEN a.ae_stage = 'applied' THEN a.ae_applied_at END) AS applied_at,
        a.follow_up_at,
        a.next_action,
        a.tailored_resume_version_id,
        a.resume_id,
        a.resume_url AS application_resume_url,
        a.resume_filename AS application_resume_filename,
        j.id AS job_id,
        j.title AS job_title,
        j.company AS company_name,
        j.company_website,
        j.source AS job_source,
        COALESCE(j.apply_url, j.source_url) AS source_url,
        j.location,
        j.salary_min,
        j.salary_max,
        j.salary_currency,
        j.eligibility_restricted,
        j.requires_citizenship,
        j.citizenship_countries,
        j.export_control_restricted,
        j.eligibility_restriction_evidence,
        tj.fit_score,
        tj.recommendation,
        sp.storage_url AS sharepoint_resume_url,
        iv.scheduled_at AS interview_scheduled_at,
        iv.time_zone AS interview_time_zone,
        iv.interview_format,
        stages.interview_stages,
        (SELECT timezone FROM candidates WHERE id = $1) AS candidate_timezone
      FROM applications a
      JOIN jobs j ON a.job_id = j.id
      LEFT JOIN target_jobs tj ON tj.job_id = j.id AND tj.candidate_id = a.candidate_id
      -- Matched to the exact resume version the "Studio" button opens
      -- (a.tailored_resume_version_id), not just any PDF ever archived for
      -- this application - a regenerate produces a new version id, so an
      -- older archived export must not be shown as if it were current.
      LEFT JOIN LATERAL (
        SELECT e.storage_url
        FROM application_resume_exports e
        WHERE e.application_id = a.id
          AND e.resume_version_id = a.tailored_resume_version_id
          AND e.export_type = 'pdf' AND e.status = 'created' AND e.storage_url IS NOT NULL
        ORDER BY COALESCE(e.updated_at, e.created_at) DESC
        LIMIT 1
      ) sp ON true
      -- Most recently created, non-cancelled interview round - see
      -- api/candidate-dashboard/route.ts for the identical join and why
      -- "most recent" is the right choice here.
      LEFT JOIN LATERAL (
        SELECT s.scheduled_at, s.time_zone, s.interview_format
        FROM interview_schedules s
        WHERE s.application_id = a.id
          AND COALESCE(s.status, 'scheduled') <> 'cancelled'
        ORDER BY
          CASE WHEN s.scheduled_at >= now() AND COALESCE(s.status, 'scheduled') IN ('scheduled', 'in_progress') THEN 0 ELSE 1 END,
          CASE WHEN s.scheduled_at >= now() AND COALESCE(s.status, 'scheduled') IN ('scheduled', 'in_progress') THEN s.scheduled_at END ASC,
          s.scheduled_at DESC NULLS LAST, s.created_at DESC
        LIMIT 1
      ) iv ON true
      -- Include cancelled rounds in the interview history and stage count.
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
          'round_number', s.round_number,
          'scheduled_at', s.scheduled_at,
          'time_zone', s.time_zone,
          'interview_format', s.interview_format,
          'status', COALESCE(s.status, 'scheduled'),
          'rescheduled_at', s.rescheduled_at
        ) ORDER BY s.round_number) AS interview_stages
        FROM interview_schedules s
        WHERE s.application_id = a.id
      ) stages ON true
      WHERE a.candidate_id = $1`,
      [candidateId]
    );

    // The Custom Interview view reuses this dashboard's row shape and columns,
    // but scopes all counts, filters, and pagination to manually added records.
    var scopedRows = sourceType === "custom_interview"
      ? allRows.filter((row) => row.source_type === "custom_interview")
      : allRows;

    // Compute status counts from display groups
    var statusCounts: Record<string, number> = emptyStatusCounts();
    var sourceCounts: Record<string, number> = {};

    for (var i = 0; i < scopedRows.length; i++) {
      var r = scopedRows[i];
      var group = dashboardStatusGroup(r);
      statusCounts[group] = (statusCounts[group] || 0) + 1;
      var src = dashboardSource(r);
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
    }

    // Apply filters
    var filtered = scopedRows;
    if (search) {
      filtered = filtered.filter(function (r) {
        return ((r.company_name || "").toLowerCase().indexOf(search) !== -1 ||
                (r.job_title || "").toLowerCase().indexOf(search) !== -1 ||
                ((r.location || "").toLowerCase().indexOf(search) !== -1));
      });
    }
    if (statusGroup && statusGroup !== "All") {
      filtered = filtered.filter(function (r) { return dashboardStatusGroup(r) === statusGroup; });
    }
    if (source) {
      filtered = filtered.filter(function (r) { return dashboardSource(r) === source.toLowerCase(); });
    }
    if (matchLevel) {
      filtered = filtered.filter(function (r) {
        var s = r.fit_score;
        if (matchLevel === "Strong" && s != null && s >= 85) return true;
        if (matchLevel === "Good" && s != null && s >= 70 && s < 85) return true;
        if (matchLevel === "Review" && s != null && s >= 60 && s < 70) return true;
        if (matchLevel === "Excluded" && (s == null || s < 60)) return true;
        return false;
      });
    }

    // Sort
    function sortValue(row: DashboardRow) {
      if (sort === "status") return dashboardStatusGroup(row);
      if (sort === "applied_at") return row.applied_at ? new Date(row.applied_at).getTime() : 0;
      return row[sort as "company_name" | "job_title" | "fit_score"] ?? "";
    }
    filtered.sort((a, b) => {
      const left = sortValue(a);
      const right = sortValue(b);
      const difference = typeof left === "number" && typeof right === "number"
        ? left - right : String(left).localeCompare(String(right));
      return difference ? (order === "asc" ? difference : -difference) : a.application_id.localeCompare(b.application_id);
    });

    var total = filtered.length;
    var offset = (page - 1) * pageSize;
    var paged = filtered.slice(offset, offset + pageSize);

    const documents = paged.length ? await query<{ application_id: string }>(
      `SELECT DISTINCT application_id FROM interview_preparation_files
       WHERE application_id = ANY($1::uuid[]) AND removed_at IS NULL AND content_type NOT LIKE 'audio/%'`,
      [paged.map((row) => row.application_id)]
    ).catch((cause: { code?: string }) => {
      if (cause.code === "42P01") return [];
      throw cause;
    }) : [];
    const prepared = new Set(documents.map((row) => row.application_id));
    const applications = paged.map((row) => ({
      ...row,
      status_group: dashboardStatusGroup(row),
      has_preparation: prepared.has(row.application_id),
    }));
    return NextResponse.json({ applications, total, page, pageSize, statusCounts, sourceCounts });
  } catch (error: any) {
    console.error("[Dashboard API] Error:", error.message);
    return NextResponse.json({ error: "Failed to load applications" }, { status: 500 });
  }
}

function dashboardStatusGroup(row: DashboardRow) {
  return applicationDashboardStatusGroup(
    row.status,
    row.application_stage,
    Boolean(row.interview_stages?.some((stage) => ["planned", "scheduled", "in_progress"].includes(stage.status))),
  );
}

function dashboardSource(row: DashboardRow) {
  return (row.source_type === "custom_interview" ? "custom_interview" : row.job_source || "unknown").toLowerCase();
}
