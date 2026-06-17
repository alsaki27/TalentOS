// src/app/api/candidates/[id]/route.ts
// GET    -> candidate profile + their applications (with job info joined)
// PATCH  -> update candidate fields (incl. resume_url after upload)
// DELETE -> remove a candidate (cascades to their applications + resume variants)

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data: candidate, error: candErr } = await supabase
    .from("candidates")
    .select("*")
    .eq("id", params.id)
    .single();

  if (candErr) return NextResponse.json({ error: candErr.message }, { status: 404 });

  // Pull applications for this candidate, joined with job details.
  const { data: applications, error: appErr } = await supabase
    .from("applications")
    .select("*, jobs(id, title, company, location, role_tier)")
    .eq("candidate_id", params.id)
    .order("applied_at", { ascending: false });

  if (appErr) return NextResponse.json({ error: appErr.message }, { status: 500 });

  const { data: resumes, error: resErr } = await supabase
    .from("resumes")
    .select("*")
    .eq("candidate_id", params.id)
    .order("created_at", { ascending: false });

  if (resErr) return NextResponse.json({ error: resErr.message }, { status: 500 });

  return NextResponse.json({ ...candidate, applications, resumes });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();

  const allowedFields = [
    "name", "email", "phone", "status", "target_tier",
    "notes", "resume_url", "resume_filename",
    "target_roles", "preferred_locations", "salary_expectation", "work_authorization",
  ];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  const { data, error } = await supabase
    .from("candidates")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await supabase.from("candidates").delete().eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
