import { NextRequest, NextResponse } from "next/server";
import { requirePublicApiScope } from "@/lib/publicApiAuth";
import { query, queryOne } from "@/server/db/neon";

function tokens(value: string | null | undefined) {
  return new Set((value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3));
}

function overlap(left: Set<string>, right: Set<string>) {
  let count = 0;
  left.forEach((token) => { if (right.has(token)) count += 1; });
  return count;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "jobs:shortlist");
  if (response) return response;

  const limit = Math.min(100, Math.max(1, parseInt(new URL(req.url).searchParams.get("limit") || "25", 10) || 25));

  const job = await queryOne(
    'SELECT id, title, company, location, role_tier, job_category, category_tags, description_text, job_function, industries FROM jobs WHERE id = $1',
    [params.id]
  );
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const candidates = await query(
    `SELECT id, name, email, status, pipeline_stage, target_tier, target_roles,
            preferred_locations, work_authorization, resume_url, resume_filename, avatar_url
       FROM candidates
      WHERE status = 'active'
        AND COALESCE(pipeline_stage, 'not_started') <> 'paused'
      ORDER BY created_at DESC LIMIT 500`,
    []
  );

  const existingApplications = await query(
    'SELECT candidate_id FROM applications WHERE job_id = $1',
    [params.id]
  );

  const alreadyApplied = new Set((existingApplications ?? []).map((application: any) => application.candidate_id as string));
  const jobTokenSet = tokens([
    job.title,
    job.location,
    job.role_tier,
    job.job_category,
    (job.category_tags ?? []).join(" "),
    job.job_function,
    job.industries,
    job.description_text,
  ].filter(Boolean).join(" "));
  const jobLocationTokens = tokens(job.location);

  const scored = (candidates ?? []).map((candidate: any) => {
    const reasons: string[] = [];
    let score = 0;
    if (candidate.status === "active") { score += 15; reasons.push("active candidate"); }
    if (candidate.resume_url) { score += 15; reasons.push("resume on file"); }
    if (candidate.target_tier && job.role_tier && candidate.target_tier === job.role_tier) {
      score += 20;
      reasons.push("target tier matches");
    }
    const roleOverlap = overlap(tokens(candidate.target_roles), jobTokenSet);
    if (roleOverlap > 0) {
      score += Math.min(25, roleOverlap * 8);
      reasons.push("target roles match job language");
    }
    const locationOverlap = overlap(tokens(candidate.preferred_locations), jobLocationTokens);
    if (locationOverlap > 0) {
      score += 10;
      reasons.push("preferred location matches");
    }
    if (candidate.work_authorization) { score += 5; reasons.push("work authorization recorded"); }
    if (alreadyApplied.has(candidate.id)) {
      score -= 40;
      reasons.push("already assigned/applied to this job");
    }
    return {
      ...candidate,
      already_on_job: alreadyApplied.has(candidate.id),
      match_score: Math.max(0, Math.min(100, score)),
      match_reasons: reasons,
    };
  }).sort((a: any, b: any) => b.match_score - a.match_score || a.name.localeCompare(b.name));

  return NextResponse.json({ data: scored.slice(0, limit) });
}
