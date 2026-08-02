import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext, ALL_USER_ROLES } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

var DISPLAY_GROUPS: Record<string, string> = {
  applied: "Applied", replied: "Screening", interview: "Interview",
  offer: "Offer", rejected: "Rejected", withdrawn: "Rejected",
  assigned: "Applied", stacked: "Applied", in_progress: "Applied",
};

interface DashboardRow {
  application_id: string;
  status: string;
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
  var search = (url.searchParams.get("search") || "").trim().toLowerCase();
  var statusGroup = url.searchParams.get("statusGroup") || "";
  var source = url.searchParams.get("source") || "";
  var page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  var pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "25", 10) || 25));
  var sort = url.searchParams.get("sort") || "applied_at";
  var order = url.searchParams.get("order") || "desc";

  var allowedSort = ["company_name", "job_title", "applied_at", "status", "candidate_name"];
  if (allowedSort.indexOf(sort) === -1) sort = "applied_at";
  if (order !== "asc" && order !== "desc") order = "desc";

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

    // Build WHERE clause
    var whereClause = "WHERE 1=1";
    var params: unknown[] = [];

    if (candidateId) {
      whereClause += " AND a.candidate_id = $" + (params.length + 1);
      params.push(candidateId);
    }

    // Fetch all rows for aggregation
    var allRows = await query<DashboardRow>(
      `SELECT
        a.id AS application_id, a.status, a.priority, a.applied_at,
        a.follow_up_at, a.next_action, a.tailored_resume_version_id,
        a.candidate_id, c.name AS candidate_name,
        j.id AS job_id, j.title AS job_title, j.company AS company_name,
        j.company_website,
        j.source AS job_source,
        COALESCE(j.apply_url, j.source_url) AS source_url,
        j.location,
        j.salary_min, j.salary_max, j.salary_currency,
        tj.fit_score, tj.recommendation
      FROM applications a
      JOIN candidates c ON c.id = a.candidate_id
      JOIN jobs j ON a.job_id = j.id
      LEFT JOIN target_jobs tj ON tj.job_id = j.id AND tj.candidate_id = a.candidate_id
      ` + whereClause + `
      ORDER BY a.applied_at DESC NULLS LAST`,
      params
    );

    // Compute aggregations
    var statusCounts: Record<string, number> = { Applied: 0, Screening: 0, Interview: 0, Offer: 0, Rejected: 0 };
    var sourceCounts: Record<string, number> = {};

    for (var i = 0; i < allRows.length; i++) {
      var group = DISPLAY_GROUPS[allRows[i].status] || allRows[i].status;
      statusCounts[group] = (statusCounts[group] || 0) + 1;
      var src = (allRows[i].job_source || "unknown").toLowerCase();
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;
    }

    // Apply filters
    var filtered = allRows;
    if (search) {
      filtered = filtered.filter(function (r) {
        return r.company_name.toLowerCase().indexOf(search) !== -1 ||
               r.job_title.toLowerCase().indexOf(search) !== -1 ||
               (r.location && r.location.toLowerCase().indexOf(search) !== -1) ||
               r.candidate_name.toLowerCase().indexOf(search) !== -1;
      });
    }
    if (statusGroup) {
      filtered = filtered.filter(function (r) { return DISPLAY_GROUPS[r.status] === statusGroup; });
    }
    if (source) {
      filtered = filtered.filter(function (r) { return r.job_source?.toLowerCase() === source.toLowerCase(); });
    }

    // Sort
    filtered.sort(function (a, b) {
      var va: any = a[sort as keyof DashboardRow] ?? "";
      var vb: any = b[sort as keyof DashboardRow] ?? "";
      if (sort === "applied_at") { va = a.applied_at ? new Date(a.applied_at).getTime() : 0; vb = b.applied_at ? new Date(b.applied_at).getTime() : 0; }
      if (typeof va === "number" && typeof vb === "number") return order === "asc" ? va - vb : vb - va;
      return order === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });

    var total = filtered.length;
    var offset = (page - 1) * pageSize;
    var paged = filtered.slice(offset, offset + pageSize);

    var selectedCandidateName: string | null = null;
    if (candidateId) {
      var cand = candidates.find(function (c) { return c.id === candidateId; });
      if (cand) selectedCandidateName = cand.name;
    }

    return NextResponse.json({
      applications: paged, total, page, pageSize,
      statusCounts, sourceCounts, candidates,
      selectedCandidateName,
    });
  } catch (error: any) {
    console.error("[Candidate Dashboard API] Error:", error.message);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
