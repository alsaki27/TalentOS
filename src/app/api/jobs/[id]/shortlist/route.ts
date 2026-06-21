import { NextResponse } from "next/server";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

function tokens(value: string | null | undefined) {
  return new Set((value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3));
}

function overlap(left: Set<string>, right: Set<string>) {
  let count = 0;
  left.forEach((token) => { if (right.has(token)) count += 1; });
  return count;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  let job: any;
  let jobError: any;

  if (isNeon()) {
    try {
      job = await queryOne(
        `SELECT id, title, company, location, role_tier, job_category, category_tags, description_text, job_function, industries FROM jobs WHERE id = $1`,
        [params.id]
      );
      jobError = job ? null : { message: "Not found" };
    } catch (err: any) {
      jobError = { message: err.message };
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("jobs")
      .select("id, title, company, location, role_tier, job_category, category_tags, description_text, job_function, industries")
      .eq("id", params.id)
      .single();
    job = res.data;
    jobError = res.error;
  }

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 404 });

  let candidates: any;
  let candidateError: any;
  let existingApplications: any;

  if (isNeon()) {
    try {
      [candidates, existingApplications] = await Promise.all([
        query(
          `SELECT id, name, email, status, target_tier, target_roles, preferred_locations, work_authorization, resume_url, resume_filename, avatar_url FROM candidates ORDER BY created_at DESC LIMIT 500`
        ),
        query(
          `SELECT candidate_id FROM applications WHERE job_id = $1`,
          [params.id]
        ),
      ]);
      candidateError = null;
    } catch (err: any) {
      candidateError = { message: err.message };
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const [candidatesRes, applicationsRes] = await Promise.all([
      supabase
        .from("candidates")
        .select("id, name, email, status, target_tier, target_roles, preferred_locations, work_authorization, resume_url, resume_filename, avatar_url")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("applications")
        .select("candidate_id")
        .eq("job_id", params.id),
    ]);
    candidates = candidatesRes.data;
    candidateError = candidatesRes.error;
    existingApplications = applicationsRes.data;
  }

  if (candidateError) return NextResponse.json({ error: candidateError.message }, { status: 500 });

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

    if (candidate.status === "active") {
      score += 15;
      reasons.push("active candidate");
    }
    if (candidate.resume_url) {
      score += 15;
      reasons.push("resume on file");
    }
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

    if (candidate.work_authorization) {
      score += 5;
      reasons.push("work authorization recorded");
    }

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

  return NextResponse.json(scored.slice(0, 25));
}
