// src/app/api/applications/route.ts
// POST -> log that a candidate applied to a job (with which resume + status)
// PATCH is handled in [id]/route.ts for status updates

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body.candidate_id || !body.job_id) {
    return NextResponse.json({ error: "candidate_id and job_id are required" }, { status: 400 });
  }

  const status = body.status ?? "applied";

  const { data, error } = await supabase
    .from("applications")
    .insert({
      candidate_id: body.candidate_id,
      job_id: body.job_id,
      status,
      resume_url: body.resume_url ?? null,
      resume_filename: body.resume_filename ?? null,
      resume_id: body.resume_id ?? null,
      follow_up_at: body.follow_up_at ?? null,
      next_action: body.next_action ?? null,
      notes: body.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    // Unique constraint violation = already applied to this job.
    if (error.code === "23505") {
      return NextResponse.json({ error: "Candidate already has an application for this job." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("application_events").insert({
    application_id: data.id,
    from_status: null,
    to_status: status,
  });

  return NextResponse.json(data, { status: 201 });
}
