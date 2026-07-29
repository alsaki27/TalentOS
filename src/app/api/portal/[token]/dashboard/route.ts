import { NextRequest, NextResponse } from "next/server";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

var DISPLAY_GROUPS: Record<string, string> = {
  applied: "Applied",
  replied: "Screening",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Rejected",
  assigned: "Applied",
  stacked: "Applied",
  in_progress: "Applied",
};

var PUBLIC_STATUS_LABELS: Record<string, string> = {
  interview: "Interview stage",
  offer: "Offer received",
  rejected: "Closed",
  withdrawn: "Closed",
  replied: "Employer responded",
};

interface PortalDashboardRow {
  application_id: string;
  status: string;
  applied_at: string | null;
  job_id: string;
  job_title: string;
  company_name: string;
  job_source: string;
  location: string | null;
  fit_score: number | null;
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  var token = params.token;

  try {
    var candidate = await query<{ id: string; name: string }>(
      "SELECT id, name FROM candidates WHERE portal_token = $1 AND (portal_token_expires_at IS NULL OR portal_token_expires_at > NOW())",
      [token]
    );

    if (candidate.length === 0) {
      return NextResponse.json({ error: "Invalid or expired portal token" }, { status: 404 });
    }

    var candidateId = candidate[0].id;
    var candidateName = candidate[0].name;

    var rows = await query<PortalDashboardRow>(
      `SELECT
        a.id AS application_id,
        a.status,
        a.applied_at,
        j.id AS job_id,
        j.title AS job_title,
        j.company AS company_name,
        j.source AS job_source,
        j.location,
        tj.fit_score
      FROM applications a
      JOIN jobs j ON a.job_id = j.id
      LEFT JOIN target_jobs tj ON tj.job_id = j.id AND tj.candidate_id = a.candidate_id
      WHERE a.candidate_id = $1
      ORDER BY a.applied_at DESC NULLS LAST`,
      [candidateId]
    );

    var statusCounts: Record<string, number> = { Applied: 0, Interview: 0, Offer: 0, Closed: 0 };
    var sourceCounts: Record<string, number> = {};

    var publicApps = rows.map(function (r) {
      var displayGroup = DISPLAY_GROUPS[r.status] || r.status;
      var publicLabel = PUBLIC_STATUS_LABELS[r.status] || "Submitted";

      // For portal, collapse to simpler categories
      var portalStage: string;
      if (r.status === "interview" || r.status === "offer") portalStage = r.status;
      else if (r.status === "rejected" || r.status === "withdrawn") portalStage = "closed";
      else if (r.status === "replied") portalStage = "replied";
      else portalStage = "submitted";

      if (portalStage === "submitted" || displayGroup === "Applied" || displayGroup === "Screening") {
        statusCounts["Applied"] = (statusCounts["Applied"] || 0) + 1;
      } else if (portalStage === "interview") {
        statusCounts["Interview"] = (statusCounts["Interview"] || 0) + 1;
      } else if (portalStage === "offer") {
        statusCounts["Offer"] = (statusCounts["Offer"] || 0) + 1;
      } else if (portalStage === "closed") {
        statusCounts["Closed"] = (statusCounts["Closed"] || 0) + 1;
      }

      var src = (r.job_source || "unknown").toLowerCase();
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;

      return {
        application_id: r.application_id,
        status: r.status,
        public_status: { stage: portalStage, label: publicLabel },
        applied_at: r.applied_at,
        job_id: r.job_id,
        job_title: r.job_title,
        company_name: r.company_name,
        job_source: r.job_source,
        location: r.location,
        fit_score: r.fit_score,
      };
    });

    return NextResponse.json({
      name: candidateName,
      applications: publicApps,
      total: publicApps.length,
      statusCounts: statusCounts,
      sourceCounts: sourceCounts,
    });
  } catch (error: any) {
    console.error("[Portal Dashboard API] Error:", error.message);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
