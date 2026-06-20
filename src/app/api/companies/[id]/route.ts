import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  if (isNeon()) {
    const company = await queryOne("SELECT * FROM companies WHERE id = $1", [params.id]);
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const jobs = await query(
      "SELECT id, title, location, source, posted_at, is_active, applicants_count, job_category, category_relevance_score FROM jobs WHERE company_id = $1 ORDER BY posted_at DESC NULLS LAST LIMIT 100",
      [params.id]
    );

    const people = await query(
      "SELECT * FROM company_people WHERE company_id = $1 ORDER BY last_seen_at DESC",
      [params.id]
    );

    const applications = await query(
      `
      SELECT a.id, a.status, a.applied_at, a.follow_up_at, a.next_action, a.assigned_to, a.assignment_due_at,
        CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id', c.id, 'name', c.name) END as candidates,
        jsonb_build_object('id', j.id, 'title', j.title, 'company_id', j.company_id) as jobs
      FROM applications a
      JOIN jobs j ON a.job_id = j.id
      LEFT JOIN candidates c ON a.candidate_id = c.id
      WHERE j.company_id = $1
      ORDER BY a.applied_at DESC NULLS LAST
      LIMIT 100
      `,
      [params.id]
    );

    const applicationIds = (applications ?? []).map((application: any) => application.id as string);
    let events: any[] = [];
    let comments: any[] = [];
    if (applicationIds.length > 0) {
      events = await query(
        "SELECT id, application_id, from_status, to_status, note, created_at FROM application_events WHERE application_id = ANY($1) ORDER BY created_at DESC LIMIT 200",
        [applicationIds]
      );
      comments = await query(
        "SELECT id, application_id, commenter_name, body, visible_to_candidate, created_at FROM application_comments WHERE application_id = ANY($1) ORDER BY created_at DESC LIMIT 200",
        [applicationIds]
      );
    }

    const appById = new Map((applications ?? []).map((application: any) => [application.id, application]));
    const applicationLogs = [
      ...(events ?? []).map((event: any) => {
        const application = appById.get(event.application_id) as any;
        return {
          id: `event:${event.id}`,
          kind: "status_event",
          application_id: event.application_id,
          created_at: event.created_at,
          candidate: application?.candidates ?? null,
          job: application?.jobs ?? null,
          from_status: event.from_status,
          to_status: event.to_status,
          body: event.note,
          actor: null,
          visible_to_candidate: false,
        };
      }),
      ...(comments ?? []).map((comment: any) => {
        const application = appById.get(comment.application_id) as any;
        return {
          id: `comment:${comment.id}`,
          kind: "comment",
          application_id: comment.application_id,
          created_at: comment.created_at,
          candidate: application?.candidates ?? null,
          job: application?.jobs ?? null,
          from_status: null,
          to_status: null,
          body: comment.body,
          actor: comment.commenter_name,
          visible_to_candidate: comment.visible_to_candidate,
        };
      }),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return NextResponse.json({
      ...company,
      jobs: jobs ?? [],
      people: people ?? [],
      applications: applications ?? [],
      application_logs: applicationLogs,
    });
  }

  const [{ data: company, error }, { data: jobs }, { data: people }, { data: applications, error: applicationsError }] = await Promise.all([
    supabase.from("companies").select("*").eq("id", params.id).single(),
    supabase
      .from("jobs")
      .select("id, title, location, source, posted_at, is_active, applicants_count, job_category, category_relevance_score")
      .eq("company_id", params.id)
      .order("posted_at", { ascending: false, nullsFirst: false })
      .limit(100),
    supabase
      .from("company_people")
      .select("*")
      .eq("company_id", params.id)
      .order("last_seen_at", { ascending: false }),
    supabase
      .from("applications")
      .select("id, status, applied_at, follow_up_at, next_action, assigned_to, assignment_due_at, candidates(id, name), jobs!inner(id, title, company_id)")
      .eq("jobs.company_id", params.id)
      .order("applied_at", { ascending: false, nullsFirst: false })
      .limit(100),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  if (applicationsError) return NextResponse.json({ error: applicationsError.message }, { status: 500 });

  const applicationIds = (applications ?? []).map((application: any) => application.id as string);
  const [{ data: events, error: eventsError }, { data: comments, error: commentsError }] = applicationIds.length > 0
    ? await Promise.all([
      supabase
        .from("application_events")
        .select("id, application_id, from_status, to_status, note, created_at")
        .in("application_id", applicationIds)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("application_comments")
        .select("id, application_id, commenter_name, body, visible_to_candidate, created_at")
        .in("application_id", applicationIds)
        .order("created_at", { ascending: false })
        .limit(200),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];

  if (eventsError) return NextResponse.json({ error: eventsError.message }, { status: 500 });
  if (commentsError) return NextResponse.json({ error: commentsError.message }, { status: 500 });

  const appById = new Map((applications ?? []).map((application: any) => [application.id, application]));
  const applicationLogs = [
    ...(events ?? []).map((event: any) => {
      const application = appById.get(event.application_id) as any;
      return {
        id: `event:${event.id}`,
        kind: "status_event",
        application_id: event.application_id,
        created_at: event.created_at,
        candidate: application?.candidates ?? null,
        job: application?.jobs ?? null,
        from_status: event.from_status,
        to_status: event.to_status,
        body: event.note,
        actor: null,
        visible_to_candidate: false,
      };
    }),
    ...(comments ?? []).map((comment: any) => {
      const application = appById.get(comment.application_id) as any;
      return {
        id: `comment:${comment.id}`,
        kind: "comment",
        application_id: comment.application_id,
        created_at: comment.created_at,
        candidate: application?.candidates ?? null,
        job: application?.jobs ?? null,
        from_status: null,
        to_status: null,
        body: comment.body,
        actor: comment.commenter_name,
        visible_to_candidate: comment.visible_to_candidate,
      };
    }),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return NextResponse.json({
    ...company,
    jobs: jobs ?? [],
    people: people ?? [],
    applications: applications ?? [],
    application_logs: applicationLogs,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const allowed = [
    "name", "website", "linkedin_url", "logo_url", "employees_count", "address",
    "slogan", "description", "notes", "source",
  ];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const field of allowed) {
    if (field in body) updates[field] = body[field] || null;
  }
  if (typeof updates.name === "string" && updates.name.trim()) {
    const name = updates.name.trim();
    updates.name = name;
    updates.normalized_name = normalizeCompanyName(name);
    updates.slug = String(updates.normalized_name).replace(/\s+/g, "-");
  }

  if (isNeon()) {
    const keys = Object.keys(updates);
    if (keys.length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = keys.map((k) => updates[k]) as (string | number | boolean | null | Date | object)[];
    values.push(params.id);
    const data = await queryOne(
      `UPDATE companies SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      values
    );
    if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });
    return NextResponse.json(data);
  }

  const { data, error } = await supabase
    .from("companies")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
