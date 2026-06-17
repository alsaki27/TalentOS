// src/app/api/applications/route.ts
// POST -> log that a candidate applied to a job (with which resume + status)
// PATCH is handled in [id]/route.ts for status updates

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const candidateIds: string[] = Array.isArray(body.candidate_ids)
    ? body.candidate_ids.filter(Boolean)
    : body.candidate_id
      ? [body.candidate_id]
      : [];

  if (candidateIds.length === 0 || !body.job_id) {
    return NextResponse.json({ error: "candidate_id/candidate_ids and job_id are required" }, { status: 400 });
  }

  const status = body.status ?? "applied";
  const { data: existing } = await supabase
    .from("applications")
    .select("candidate_id")
    .eq("job_id", body.job_id)
    .in("candidate_id", candidateIds);

  const existingCandidateIds = new Set((existing ?? []).map((row) => row.candidate_id as string));
  const newCandidateIds = candidateIds.filter((id) => !existingCandidateIds.has(id));

  if (newCandidateIds.length === 0) {
    return NextResponse.json({ error: "All selected candidates already have applications for this job." }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("applications")
    .insert(newCandidateIds.map((candidateId) => ({
      candidate_id: candidateId,
      job_id: body.job_id,
      status,
      resume_url: body.resume_url ?? null,
      resume_filename: body.resume_filename ?? null,
      resume_id: body.resume_id ?? null,
      follow_up_at: body.follow_up_at ?? null,
      next_action: body.next_action ?? null,
      notes: body.notes ?? null,
      assigned_by: body.assigned_by ?? null,
      assigned_to: body.assigned_to ?? null,
      assignment_note: body.assignment_note ?? null,
      assignment_due_at: body.assignment_due_at ?? null,
    })))
    .select();

  if (error) {
    // Unique constraint violation = already applied to this job.
    if (error.code === "23505") {
      return NextResponse.json({ error: "Candidate already has an application for this job." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("application_events").insert((data ?? []).map((application) => ({
    application_id: application.id,
    from_status: null,
    to_status: status,
    note: body.event_note ?? body.assignment_note ?? null,
  })));

  return NextResponse.json({
    created: data ?? [],
    imported: data?.length ?? 0,
    skipped: candidateIds.length - newCandidateIds.length,
  }, { status: 201 });
}
