import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext, ALL_USER_ROLES } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

var DISPLAY_GROUPS: Record<string, string> = {
  applied: "Applied", replied: "Screening", interview: "Interview",
  offer: "Offer", rejected: "Rejected", withdrawn: "Rejected",
  assigned: "Applied", stacked: "Applied", in_progress: "Applied",
};

// Inverse of DISPLAY_GROUPS: display group -> raw status/ae_stage values that
// belong to it, so a "statusGroup" filter can be pushed down into SQL.
var STATUSES_BY_GROUP: Record<string, string[]> = {};
for (var rawStatusKey in DISPLAY_GROUPS) {
  var groupName = DISPLAY_GROUPS[rawStatusKey];
  if (!STATUSES_BY_GROUP[groupName]) STATUSES_BY_GROUP[groupName] = [];
  STATUSES_BY_GROUP[groupName].push(rawStatusKey);
}

// The computed "display status" every filter/sort/count query must agree on:
// applications marked applied via ae_stage collapse to the raw "applied"
// status regardless of the legacy a.status value underneath - but only while
// the AE pipeline itself is what set ae_stage='applied'. Without the
// "AND a.status IN (...)" guard, an application the AI email-triage pipeline
// later moved to e.g. 'interview' (see applicationStatusService.ts) would
// still display as "Applied" forever, since ae_stage stays 'applied' from
// the original AE hand-off and this expression would keep masking the real
// status underneath it.
var STATUS_EXPR = "(CASE WHEN a.ae_stage = 'applied' AND a.status IN ('assigned', 'stacked', 'in_progress') THEN 'applied' ELSE a.status END)";

// Escapes ILIKE wildcard/escape characters in free-text search input so a
// literal "%", "_", or "\" the user typed is matched literally, not as a
// pattern operator.
function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, function (ch) { return "\\" + ch; });
}

interface DashboardRow {
  application_id: string;
  status: string;
  ae_stage: string;
  priority: string | null;
  applied_at: string | null;
  follow_up_at: string | null;
  next_action: string | null;
  candidate_id: string;
  candidate_name: string;
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
  fit_score: number | null;
  recommendation: string | null;
  tailored_resume_version_id: string | null;
}

interface CandidateOption {
  id: string;
  name: string;
  application_count: number;
}

export async function GET(req: NextRequest) {
  var currentUser = await getCurrentUserContext();
  if (!currentUser) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!ALL_USER_ROLES.includes(currentUser.profile.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  var url = new URL(req.url);
  var candidateId = url.searchParams.get("candidateId") || "";
  var search = (url.searchParams.get("search") || "").trim();
  var statusGroup = url.searchParams.get("statusGroup") || "";
  var source = url.searchParams.get("source") || "";
  var page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  var pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "25", 10) || 25));
  var sort = url.searchParams.get("sort") || "applied_at";
  var order = url.searchParams.get("order") || "desc";

  var allowedSort = ["company_name", "job_title", "applied_at", "status", "candidate_name"];
  if (allowedSort.indexOf(sort) === -1) sort = "applied_at";
  if (order !== "asc" && order !== "desc") order = "desc";

  // SQL expression per sortable column - kept as expressions (not output
  // aliases) so ORDER BY is unambiguous regardless of how Postgres resolves
  // alias vs. column-name precedence.
  var sortExpressions: Record<string, string> = {
    company_name: "j.company",
    job_title: "j.title",
    applied_at: "COALESCE(a.applied_at, CASE WHEN a.ae_stage = 'applied' THEN a.ae_applied_at END)",
    status: STATUS_EXPR,
    candidate_name: "c.name",
  };

  try {
    // Fetch candidates with application counts
    var candidates = await query<CandidateOption>(
      `SELECT c.id, c.name, COUNT(a.id)::int AS application_count
       FROM candidates c
       JOIN applications a ON a.candidate_id = c.id
       WHERE c.status = 'active'
       GROUP BY c.id, c.name
       HAVING COUNT(a.id) > 0
       ORDER BY c.name ASC`
    );

    // Shared candidate scope for the two aggregate count queries below - the
    // status/source breakdown charts always reflect the full picture for the
    // selected candidate (or everyone), independent of the active
    // search/statusGroup/source table filters.
    var candidateWhere = "";
    var candidateParams: unknown[] = [];
    if (candidateId) {
      candidateWhere = " WHERE a.candidate_id = $1";
      candidateParams.push(candidateId);
    }

    var statusCountRows = await query<{ raw_status: string; n: number }>(
      `SELECT ${STATUS_EXPR} AS raw_status, COUNT(*)::int AS n
         FROM applications a
         JOIN jobs j ON a.job_id = j.id
       ${candidateWhere}
       GROUP BY 1`,
      candidateParams
    );
    var sourceCountRows = await query<{ src: string; n: number }>(
      `SELECT LOWER(COALESCE(j.source, 'unknown')) AS src, COUNT(*)::int AS n
         FROM applications a
         JOIN jobs j ON a.job_id = j.id
       ${candidateWhere}
       GROUP BY 1`,
      candidateParams
    );

    var statusCounts: Record<string, number> = { Applied: 0, Screening: 0, Interview: 0, Offer: 0, Rejected: 0 };
    for (var sRow of statusCountRows) {
      var group = DISPLAY_GROUPS[sRow.raw_status] || sRow.raw_status;
      statusCounts[group] = (statusCounts[group] || 0) + sRow.n;
    }
    var sourceCounts: Record<string, number> = {};
    for (var srcRow of sourceCountRows) sourceCounts[srcRow.src] = srcRow.n;

    // Build the filtered/sorted/paginated applications query entirely in SQL
    // - search, status, and source all push down into the WHERE clause
    // instead of pulling every matching row into memory and filtering in JS.
    var whereClause = "WHERE 1=1";
    var params: unknown[] = [];

    if (candidateId) {
      whereClause += " AND a.candidate_id = $" + (params.length + 1);
      params.push(candidateId);
    }

    if (search) {
      var searchIdx = params.length + 1;
      whereClause +=
        " AND (j.company ILIKE $" + searchIdx +
        " OR j.title ILIKE $" + searchIdx +
        " OR j.location ILIKE $" + searchIdx +
        " OR c.name ILIKE $" + searchIdx + " ESCAPE '\\')";
      params.push("%" + escapeLikeTerm(search) + "%");
    }

    if (statusGroup) {
      var rawStatuses = STATUSES_BY_GROUP[statusGroup] || [];
      if (rawStatuses.length) {
        whereClause += " AND " + STATUS_EXPR + " = ANY($" + (params.length + 1) + ")";
        params.push(rawStatuses);
      } else {
        whereClause += " AND 1=0";
      }
    }

    if (source) {
      whereClause += " AND LOWER(j.source) = LOWER($" + (params.length + 1) + ")";
      params.push(source);
    }

    var orderSql = sortExpressions[sort] + " " + (order === "asc" ? "ASC" : "DESC") + " NULLS LAST";
    var limitIdx = params.length + 1;
    var offsetIdx = params.length + 2;
    params.push(pageSize, (page - 1) * pageSize);

    var rows = await query<DashboardRow & { total_count: number }>(
      `SELECT
        a.id AS application_id,
        ${STATUS_EXPR} AS status,
        a.ae_stage,
        a.priority,
        COALESCE(a.applied_at, CASE WHEN a.ae_stage = 'applied' THEN a.ae_applied_at END) AS applied_at,
        a.follow_up_at, a.next_action, a.tailored_resume_version_id,
        a.candidate_id, c.name AS candidate_name,
        j.id AS job_id, j.title AS job_title, j.company AS company_name,
        j.company_website,
        j.source AS job_source,
        COALESCE(j.apply_url, j.source_url) AS source_url,
        j.location,
        j.salary_min, j.salary_max, j.salary_currency,
        tj.fit_score, tj.recommendation,
        COUNT(*) OVER()::int AS total_count
      FROM applications a
      JOIN candidates c ON c.id = a.candidate_id
      JOIN jobs j ON a.job_id = j.id
      LEFT JOIN target_jobs tj ON tj.job_id = j.id AND tj.candidate_id = a.candidate_id
      ${whereClause}
      ORDER BY ${orderSql}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    var total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    var paged: DashboardRow[] = rows.map(function (r) {
      var copy: any = { ...r };
      delete copy.total_count;
      return copy;
    });

    var selectedCandidateName: string | null = null;
    if (candidateId) {
      var cand = candidates.find(function (c) { return c.id === candidateId; });
      if (cand) selectedCandidateName = cand.name;
    }

    // Counts only, not the up-to-100 joined rows this used to return on
    // every dashboard load (see /inbox and /inbox/approvals for the actual
    // work queue - this dashboard just needs to know whether to show a
    // link and how many badges to put on it).
    var taskParams: unknown[] = [];
    var taskFilter = "";
    if (candidateId) {
      taskFilter = " AND candidate_id = $1";
      taskParams.push(candidateId);
    }
    var emailTaskCountsRow = await queryOne<{ pending_approvals: number; needs_reply: number; interviews: number; untracked: number; total: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE type = 'status_change_approval')::int AS pending_approvals,
         COUNT(*) FILTER (WHERE type = 'needs_reply')::int AS needs_reply,
         COUNT(*) FILTER (WHERE type = 'interview_followup')::int AS interviews,
         COUNT(*) FILTER (WHERE type = 'untracked_application')::int AS untracked,
         COUNT(*)::int AS total
       FROM action_items
       WHERE status IN ('open', 'in_progress')${taskFilter}`,
      taskParams
    );
    var emailTaskCounts = {
      pendingApprovals: emailTaskCountsRow?.pending_approvals ?? 0,
      needsReply: emailTaskCountsRow?.needs_reply ?? 0,
      interviews: emailTaskCountsRow?.interviews ?? 0,
      untracked: emailTaskCountsRow?.untracked ?? 0,
      total: emailTaskCountsRow?.total ?? 0,
    };

    return NextResponse.json({
      applications: paged, total, page, pageSize,
      statusCounts, sourceCounts, candidates,
      selectedCandidateName,
      emailTaskCounts,
    });
  } catch (error: any) {
    console.error("[Candidate Dashboard API] Error:", error.message);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
