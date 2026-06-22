// src/app/api/interviews/route.ts
// GET  -> paginated/filterable list of interviews with candidate + job info
// POST -> create an interview schedule with panel members

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

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

  if (isNeon()) {
    const offset = (page - 1) * pageSize;
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (status) { conditions.push(`s.status = $${idx++}`); params.push(status); }
    if (candidateId) { conditions.push(`a.candidate_id = $${idx++}`); params.push(candidateId); }
    if (jobId) { conditions.push(`a.job_id = $${idx++}`); params.push(jobId); }
    if (dateFrom) { conditions.push(`s.scheduled_at >= $${idx++}`); params.push(dateFrom); }
    if (dateTo) { conditions.push(`s.scheduled_at <= $${idx++}`); params.push(`${dateTo}T23:59:59`); }
    if (search) { conditions.push(`s.round_name ILIKE $${idx++}`); params.push(`%${search}%`); }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countSql = `
      SELECT COUNT(*) as count
      FROM interview_schedules s
      JOIN applications a ON s.application_id = a.id
      ${whereClause}
    `;
    const countRow = await queryOne<{ count: string }>(countSql, params);
    const total = parseInt(countRow?.count ?? "0", 10);

    const dataSql = `
      SELECT s.*,
        jsonb_build_object(
          'candidate_id', a.candidate_id,
          'job_id', a.job_id,
          'candidates', CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email) END,
          'jobs', CASE WHEN j.id IS NOT NULL THEN jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company) END
        ) as applications
      FROM interview_schedules s
      JOIN applications a ON s.application_id = a.id
      LEFT JOIN candidates c ON a.candidate_id = c.id
      LEFT JOIN jobs j ON a.job_id = j.id
      ${whereClause}
      ORDER BY s.scheduled_at ASC
      OFFSET $${idx++} LIMIT $${idx++}
    `;
    const schedules = await query(dataSql, [...params, offset, pageSize]);

    // Fetch panel members for each schedule
    const scheduleIds = (schedules ?? []).map((s: any) => s.id as string);
    let panelWithProfiles: any[] = [];
    if (scheduleIds.length > 0) {
      const schedPlaceholders = scheduleIds.map((_, i) => `$${i + 1}`).join(", ");
      const panels = await query(
        `SELECT * FROM interview_panel_members WHERE schedule_id::text IN (${schedPlaceholders})`,
        scheduleIds
      );
      const interviewerIds = (panels ?? []).map((p: any) => p.interviewer_id as string).filter(Boolean);
      let profiles: any[] = [];
      if (interviewerIds.length > 0) {
        const profPlaceholders = interviewerIds.map((_, i) => `$${i + 1}`).join(", ");
        profiles = await query(
          `SELECT user_id, display_name, email FROM profiles WHERE user_id::text IN (${profPlaceholders})`,
          interviewerIds
        );
      }
      const profileById = new Map(profiles.map((p: any) => [p.user_id as string, p]));
      panelWithProfiles = (panels ?? []).map((pm: any) => ({
        ...pm,
        profile: profileById.get(pm.interviewer_id as string) ?? null,
      }));
    }

    const panelBySchedule = new Map<string, any[]>();
    for (const pm of panelWithProfiles) {
      const list = panelBySchedule.get(pm.schedule_id as string) ?? [];
      list.push(pm);
      panelBySchedule.set(pm.schedule_id as string, list);
    }

    const items = (schedules ?? []).map((schedule: any) => ({
      ...schedule,
      panel: panelBySchedule.get(schedule.id) ?? [],
    }));

    return NextResponse.json({ items, total, page, pageSize });
  } else {
    const { supabase } = await import("@/lib/supabase");
    let dbQuery = supabase
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

    if (status) dbQuery = dbQuery.eq("status", status);
    if (candidateId) dbQuery = dbQuery.eq("applications.candidate_id", candidateId);
    if (jobId) dbQuery = dbQuery.eq("applications.job_id", jobId);
    if (dateFrom) dbQuery = dbQuery.gte("scheduled_at", dateFrom);
    if (dateTo) dbQuery = dbQuery.lte("scheduled_at", dateTo + "T23:59:59");
    if (search) {
      dbQuery = dbQuery.ilike("round_name", `%${search}%`);
    }

    const from = (page - 1) * pageSize;
    const { data: schedules, error: dataErr, count } = await dbQuery
      .order("scheduled_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (dataErr) return NextResponse.json({ error: dataErr.message }, { status: 500 });

    // Fetch panel members for each schedule
    const scheduleIds = (schedules ?? []).map((s: any) => s.id as string);
    let panelWithProfiles: any[] = [];
    if (scheduleIds.length > 0) {
      const { data: panels } = await supabase
        .from("interview_panel_members")
        .select("*")
        .in("schedule_id", scheduleIds);
      const interviewerIds = (panels ?? []).map((p: any) => p.interviewer_id as string).filter(Boolean);
      let profiles: any[] = [];
      if (interviewerIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, display_name, email")
          .in("user_id", interviewerIds);
        profiles = profs ?? [];
      }
      const profileById = new Map(profiles.map((p: any) => [p.user_id as string, p]));
      panelWithProfiles = (panels ?? []).map((pm: any) => ({
        ...pm,
        profile: profileById.get(pm.interviewer_id as string) ?? null,
      }));
    }

    const panelBySchedule = new Map<string, any[]>();
    for (const pm of panelWithProfiles) {
      const list = panelBySchedule.get(pm.schedule_id as string) ?? [];
      list.push(pm);
      panelBySchedule.set(pm.schedule_id as string, list);
    }

    const items = (schedules ?? []).map((schedule: any) => ({
      ...schedule,
      panel: panelBySchedule.get(schedule.id) ?? [],
    }));

    return NextResponse.json({ items, total: count ?? 0, page, pageSize });
  }
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

  if (isNeon()) {
    const schedule = await queryOne(
      `INSERT INTO interview_schedules (application_id, round_number, round_name, scheduled_at, duration_minutes, location, meeting_link, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [body.applicationId, body.roundNumber ?? 1, body.roundName, body.scheduledAt, body.durationMinutes ?? 60, body.location ?? null, body.meetingLink ?? null, "scheduled", context.profile.user_id]
    );
    if (!schedule) {
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }

    // Insert panel members
    const panel = Array.isArray(body.panel) ? body.panel : [];
    if (panel.length > 0) {
      const cols = ["schedule_id", "interviewer_id", "role", "status"];
      const placeholders: string[] = [];
      const values: any[] = [];
      let idx = 1;
      for (const p of panel) {
        const rowPlaceholders: string[] = [];
        for (const _ of cols) {
          rowPlaceholders.push(`$${idx++}`);
        }
        placeholders.push(`(${rowPlaceholders.join(", ")})`);
        values.push(schedule.id, p.interviewerId, p.role ?? "interviewer", "pending");
      }
      try {
        await execute(
          `INSERT INTO interview_panel_members (${cols.join(", ")}) VALUES ${placeholders.join(", ")}`,
          values
        );
      } catch (err: any) {
        console.error("Panel insert error:", err.message);
      }
    }

    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
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
  } else {
    const { supabase } = await import("@/lib/supabase");
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
        console.error("Panel insert error:", panelErr.message);
      }
    }

    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
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
}
