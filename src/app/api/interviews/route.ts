// src/app/api/interviews/route.ts
// GET  -> paginated/filterable list of interviews with candidate + job info
// POST -> create an interview schedule with panel members

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const status = url.searchParams.get("status") || "";
  const candidateId = url.searchParams.get("candidateId") || "";
  const jobId = url.searchParams.get("jobId") || "";
  const search = (url.searchParams.get("search") || "").trim();
  const dateFrom = url.searchParams.get("dateFrom") || "";
  const dateTo = url.searchParams.get("dateTo") || "";

  let query = supabase
    .from("interview_schedules")
    .select(`
      *,
      applications!inner(
        candidate_id,
        job_id,
        candidates(id, name, email),
        jobs(id, title, company)
      )
    `, { count: "exact" });

  if (status) query = query.eq("status", status);
  if (candidateId) query = query.eq("applications.candidate_id", candidateId);
  if (jobId) query = query.eq("applications.job_id", jobId);
  if (dateFrom) query = query.gte("scheduled_at", dateFrom);
  if (dateTo) query = query.lte("scheduled_at", dateTo + "T23:59:59");
  if (search) {
    query = query.ilike("round_name", `%${search}%`);
  }

  const from = (page - 1) * pageSize;
  const { data: schedules, error: dataErr, count } = await query
    .order("scheduled_at", { ascending: true })
    .range(from, from + pageSize - 1);

  if (dataErr) return NextResponse.json({ error: dataErr.message }, { status: 500 });

  // Fetch panel members for each schedule
  const scheduleIds = (schedules ?? []).map((s: any) => s.id);
  let panelWithProfiles: any[] = [];
  if (scheduleIds.length > 0) {
    const { data: panels } = await supabase
      .from("interview_panel_members")
      .select("*")
      .in("schedule_id", scheduleIds);
    const interviewerIds = (panels ?? []).map((p) => p.interviewer_id).filter(Boolean);
    let profiles: any[] = [];
    if (interviewerIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("user_id, display_name, email")
        .in("user_id", interviewerIds);
      profiles = profs ?? [];
    }
    const profileById = new Map(profiles.map((p) => [p.user_id, p]));
    panelWithProfiles = (panels ?? []).map((pm) => ({
      ...pm,
      profile: profileById.get(pm.interviewer_id) ?? null,
    }));
  }

  const panelBySchedule = new Map<string, any[]>();
  for (const pm of panelWithProfiles) {
    const list = panelBySchedule.get(pm.schedule_id) ?? [];
    list.push(pm);
    panelBySchedule.set(pm.schedule_id, list);
  }

  const items = (schedules ?? []).map((schedule) => ({
    ...schedule,
    panel: panelBySchedule.get(schedule.id) ?? [],
  }));

  return NextResponse.json({ items, total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();

  if (!body.applicationId || !body.roundName || !body.scheduledAt) {
    return NextResponse.json(
      { error: "applicationId, roundName, and scheduledAt are required" },
      { status: 400 }
    );
  }

  const { data: schedule, error: scheduleErr } = await supabase
    .from("interview_schedules")
    .insert({
      application_id: body.applicationId,
      round_number: body.roundNumber ?? 1,
      round_name: body.roundName,
      scheduled_at: body.scheduledAt,
      duration_minutes: body.durationMinutes ?? 60,
      location: body.location ?? null,
      meeting_link: body.meetingLink ?? null,
      status: "scheduled",
      created_by: context.profile.user_id,
    })
    .select()
    .single();

  if (scheduleErr || !schedule) {
    return NextResponse.json({ error: scheduleErr?.message || "Insert failed" }, { status: 500 });
  }

  // Insert panel members
  const panel = Array.isArray(body.panel) ? body.panel : [];
  if (panel.length > 0) {
    const { error: panelErr } = await supabase.from("interview_panel_members").insert(
      panel.map((p: any) => ({
        schedule_id: schedule.id,
        interviewer_id: p.interviewerId,
        role: p.role ?? "interviewer",
        status: "pending",
      }))
    );
    if (panelErr) {
      // Best-effort; don't fail the whole request
      console.error("Panel insert error:", panelErr.message);
    }
  }

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email,
    type: "create",
    description: `Scheduled interview: ${body.roundName}`,
    entityType: "interview",
    entityId: schedule.id,
    entityName: body.roundName,
    metadata: {
      application_id: body.applicationId,
      round_name: body.roundName,
      scheduled_at: body.scheduledAt,
    },
  });

  return NextResponse.json(schedule, { status: 201 });
}
