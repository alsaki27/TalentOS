// src/app/api/jobs/route.ts
// GET  -> masterlist of jobs, each with applicant count + names (for the dashboard)
// POST -> manually add one job

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  // Pull jobs + their applications joined with candidate name.
  // We keep this one query rather than N+1 per job.
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*, applications(id, status, candidates(id, name, avatar_url))")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Shape it so the dashboard gets a clean "applicant_count" + "applicants" list per job.
  const shaped = (jobs ?? []).map((job: any) => ({
    ...job,
    applicant_count: job.applications?.length ?? 0,
    applicants: (job.applications ?? []).map((a: any) => ({
      candidate_id: a.candidates?.id,
      name: a.candidates?.name,
      avatar_url: a.candidates?.avatar_url,
      status: a.status,
    })),
  }));

  return NextResponse.json(shaped);
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("jobs")
    .insert({
      title: body.title,
      company: body.company ?? null,
      location: body.location ?? null,
      source: "manual",
      role_tier: body.role_tier ?? null,
      salary_range: body.salary_range ?? null,
      source_url: body.source_url ?? null,
      notes: body.notes ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
