// src/app/api/interviews/[id]/route.ts
// GET    -> interview detail with full panel + scorecards
// PATCH  -> update interview (reschedule, cancel, complete)
// DELETE -> delete interview (cascades to panel + scorecards)

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  if (isNeon()) {
    const interview = await queryOne(
      `
      SELECT s.*,
        jsonb_build_object(
          'candidate_id', a.candidate_id,
          'job_id', a.job_id,
          'candidates', CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone, 'resume_url', c.resume_url, 'resume_filename', c.resume_filename) END,
          'jobs', CASE WHEN j.id IS NOT NULL THEN jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company, 'location', j.location) END
        ) as applications
      FROM interview_schedules s
      JOIN applications a ON s.application_id = a.id
      LEFT JOIN candidates c ON a.candidate_id = c.id
      LEFT JOIN jobs j ON a.job_id = j.id
      WHERE s.id = $1
      `,
      [params.id]
    );
    if (!interview) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Panel members with profile info
    const panel = await query(
      "SELECT * FROM interview_panel_members WHERE schedule_id = $1 ORDER BY created_at ASC",
      [params.id]
    );

    // Scorecards
    const scorecards = await query(
      "SELECT * FROM interview_scorecards WHERE schedule_id = $1 ORDER BY submitted_at ASC",
      [params.id]
    );

    // Fetch profiles for panel members
    const interviewerIds = (panel ?? []).map((p: any) => p.interviewer_id as string).filter(Boolean);
    let profiles: any[] = [];
    if (interviewerIds.length > 0) {
      const profPlaceholders = interviewerIds.map((_, i) => `$${i + 1}`).join(", ");
      profiles = await query(
        `SELECT user_id, display_name, email, role FROM profiles WHERE user_id::text IN (${profPlaceholders})`,
        interviewerIds
      );
    }

    const profileById = new Map(profiles.map((p: any) => [p.user_id as string, p]));
    const panelWithProfiles = (panel ?? []).map((p: any) => ({
      ...p,
      profile: profileById.get(p.interviewer_id as string) ?? null,
    }));

    return NextResponse.json({
      ...interview,
      panel: panelWithProfiles,
      scorecards: scorecards ?? [],
    });
  } else {
    const { supabase } = await import("@/lib/supabase");
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
    const interviewerIds = (panel ?? []).map((p: any) => p.interviewer_id).filter(Boolean);
    let profiles: any[] = [];
    if (interviewerIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, display_name, email, role")
        .in("user_id", interviewerIds);
      profiles = profs ?? [];
    }

    const profileById = new Map(profiles.map((p: any) => [p.user_id as string, p]));
    const panelWithProfiles = (panel ?? []).map((p: any) => ({
      ...p,
      profile: profileById.get(p.interviewer_id as string) ?? null,
    }));

    return NextResponse.json({
      ...interview,
      panel: panelWithProfiles,
      scorecards: scorecards ?? [],
    });
  }
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

  if (isNeon()) {
    const keys = Object.keys(updates);
    if (keys.length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = keys.map((k) => updates[k]) as (string | number | boolean | null | Date | object)[];
    values.push(params.id);
    const data = await queryOne(
      `UPDATE interview_schedules SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      values
    );
    if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });

    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "update",
      description: `Updated interview ${params.id}`,
      entityType: "interview",
      entityId: params.id,
      metadata: { fields: Object.keys(updates) },
    });

    return NextResponse.json(data);
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("interview_schedules")
      .update(updates)
      .eq("id", params.id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "update",
      description: `Updated interview ${params.id}`,
      entityType: "interview",
      entityId: params.id,
      metadata: { fields: Object.keys(updates) },
    });

    return NextResponse.json(data);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  if (isNeon()) {
    await execute("DELETE FROM interview_schedules WHERE id = $1", [params.id]);

    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "delete",
      description: `Deleted interview ${params.id}`,
      entityType: "interview",
      entityId: params.id,
    });

    return NextResponse.json({ ok: true });
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { error } = await supabase.from("interview_schedules").delete().eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "delete",
      description: `Deleted interview ${params.id}`,
      entityType: "interview",
      entityId: params.id,
    });

    return NextResponse.json({ ok: true });
  }
}
