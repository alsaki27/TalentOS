// src/app/api/interviews/[id]/route.ts
// GET    -> interview detail with full panel + scorecards
// PATCH  -> update interview (reschedule, cancel, complete)
// DELETE -> delete interview (cascades to panel + scorecards)

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const { data: interview, error: interviewErr } = await supabase
    .from("interview_schedules")
    .select(`
      *,
      applications!inner(
        candidate_id,
        job_id,
        candidates(id, name, email, phone, resume_url, resume_filename),
        jobs(id, title, company, location)
      )
    `)
    .eq("id", params.id)
    .single();

  if (interviewErr || !interview) {
    return NextResponse.json({ error: interviewErr?.message || "Not found" }, { status: 404 });
  }

  // Panel members with profile info
  const { data: panel } = await supabase
    .from("interview_panel_members")
    .select("*")
    .eq("schedule_id", params.id)
    .order("created_at", { ascending: true });

  // Scorecards
  const { data: scorecards } = await supabase
    .from("interview_scorecards")
    .select("*")
    .eq("schedule_id", params.id)
    .order("submitted_at", { ascending: true });

  // Fetch profiles for panel members
  const interviewerIds = (panel ?? []).map((p) => p.interviewer_id).filter(Boolean);
  let profiles: any[] = [];
  if (interviewerIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("user_id, display_name, email, role")
      .in("user_id", interviewerIds);
    profiles = profs ?? [];
  }

  const profileById = new Map(profiles.map((p) => [p.user_id, p]));
  const panelWithProfiles = (panel ?? []).map((p) => ({
    ...p,
    profile: profileById.get(p.interviewer_id) ?? null,
  }));

  return NextResponse.json({
    ...interview,
    panel: panelWithProfiles,
    scorecards: scorecards ?? [],
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();

  const allowedFields = [
    "round_name",
    "round_number",
    "scheduled_at",
    "duration_minutes",
    "location",
    "meeting_link",
    "status",
  ];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  const { data, error } = await supabase
    .from("interview_schedules")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email,
    type: "update",
    description: `Updated interview ${params.id}`,
    entityType: "interview",
    entityId: params.id,
    metadata: { fields: Object.keys(updates) },
  });

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const { error } = await supabase.from("interview_schedules").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email,
    type: "delete",
    description: `Deleted interview ${params.id}`,
    entityType: "interview",
    entityId: params.id,
  });

  return NextResponse.json({ ok: true });
}
