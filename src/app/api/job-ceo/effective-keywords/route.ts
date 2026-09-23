import { NextRequest, NextResponse } from "next/server";
import { query } from "@/server/db/neon";
import { getAllGroups, getGroupIds } from "@/lib/jobAgentRoleLibrary";

export const dynamic = "force-dynamic";

// Machine-readable read path for "the keyword set Job CEO is currently
// configured to search for" — static role-library groups (A–R) plus any
// custom groups a staff member has added via the Job Agent / Job CEO pages.
//
// This exists because the two things that already read this data both
// require a logged-in staff session: GET /api/job-agent/keyword-groups and
// GET /api/job-ceo/keyword-groups both sit behind requireCurrentUser(...),
// which a scheduled GitHub Actions job cannot present. Before this route,
// scripts/openjobdata_ingest.py worked around that by hand-maintaining its
// own hardcoded Python mirror of jobAgentRoleLibrary.ts's static groups —
// which is why it has never picked up a single custom keyword group added
// through the UI. Any script (this repo's or new agency-source ingesters)
// that needs "today's effective keyword set" should call this instead of
// re-copying or re-guessing the role library.
//
// Bearer-authenticated with the same JOB_CEO_INGEST_SECRET as
// /api/job-ceo/ingest (fail-closed, identical check) rather than a staff
// session — this is a read of non-sensitive, already-admin-visible
// configuration data, not candidate or applicant data.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const secret = process.env.JOB_CEO_INGEST_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const roleGroupParam = (url.searchParams.get("role_group") || "all").trim();
  const requestedIds =
    roleGroupParam.toLowerCase() === "all"
      ? getGroupIds()
      : roleGroupParam.split(",").map((id) => id.trim().toUpperCase()).filter(Boolean);
  const requestedSet = new Set(requestedIds);

  const groups: Record<string, { label: string; resume_family: string; titles: string[] }> = {};
  for (const group of getAllGroups()) {
    if (!requestedSet.has(group.id)) continue;
    groups[group.id] = { label: group.label, resume_family: group.resumeFamily, titles: group.titles };
  }

  let custom: { id: string; label: string; keywords: string[] }[] = [];
  try {
    const rows = await query<{ id: string; label: string; keywords: unknown }>(
      "SELECT id, label, keywords FROM job_agent_keyword_groups ORDER BY created_at ASC"
    );
    custom = rows.map((r) => ({
      id: r.id,
      label: r.label,
      keywords: Array.isArray(r.keywords) ? (r.keywords as string[]) : JSON.parse(String(r.keywords ?? "[]")),
    }));
  } catch (err) {
    // Static groups are still useful without the DB — degrade, don't fail
    // the whole response, but surface it so a caller can tell coverage is
    // reduced rather than silently getting a partial answer.
    console.error("[Job CEO] effective-keywords: could not load custom keyword groups:", err);
    return NextResponse.json(
      { groups, custom: [], custom_groups_error: (err as Error).message ?? String(err), generated_at: new Date().toISOString() },
      { status: 200 }
    );
  }

  return NextResponse.json({ groups, custom, generated_at: new Date().toISOString() });
}
