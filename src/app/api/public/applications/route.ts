import { NextRequest, NextResponse } from "next/server";
import { applicationAutomation } from "@/lib/applicationAutomation";
import { pageParams, pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

const APPLICATION_FIELDS = [
  "candidate_id", "job_id", "status", "resume_url", "resume_filename", "resume_id",
  "follow_up_at", "next_action", "notes", "assigned_by", "assigned_to",
  "assigned_by_user_id", "assigned_to_user_id", "assignment_note", "assignment_due_at",
  "priority", "review_status", "review_note",
];

function isAssignmentPayload(body: any) {
  return ["assigned", "stacked", "in_progress"].includes(body.status) || Boolean(body.assigned_to || body.assigned_to_user_id);
}

export async function GET(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "applications:read");
  if (response) return response;

  const { url, page, pageSize, from, to } = pageParams(req, { page: 1, pageSize: 50, maxPageSize: 150 });
  const status = url.searchParams.get("status") || "";
  const candidateId = url.searchParams.get("candidate_id") || "";
  const jobId = url.searchParams.get("job_id") || "";
  const assignedToUserId = url.searchParams.get("assigned_to_user_id") || "";
  const priority = url.searchParams.get("priority") || "";

  let query = supabase
    .from("applications")
    .select("*, candidates(id, name, email), jobs(id, title, company, location)", { count: "planned" })
    .order("applied_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (candidateId) query = query.eq("candidate_id", candidateId);
  if (jobId) query = query.eq("job_id", jobId);
  if (assignedToUserId) query = query.eq("assigned_to_user_id", assignedToUserId);
  if (priority) query = query.eq("priority", priority);

  const { data, error, count } = await query.range(from, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "applications:write");
  if (response) return response;

  const body = await req.json();
  if (!body.candidate_id || !body.job_id) {
    return NextResponse.json({ error: "candidate_id and job_id are required" }, { status: 400 });
  }
  if (isAssignmentPayload(body)) {
    const assignmentAuth = await requirePublicApiScope(req, "applications:assign");
    if (assignmentAuth.response) return assignmentAuth.response;
  }

  const status = body.status ?? "applied";
  const automated = applicationAutomation({
    status,
    explicitFollowUp: "follow_up_at" in body,
    explicitNextAction: "next_action" in body,
    explicitAssignmentDue: "assignment_due_at" in body,
  });

  const row = {
    ...pickFields(body, APPLICATION_FIELDS),
    status,
    follow_up_at: "follow_up_at" in body ? body.follow_up_at : automated.follow_up_at ?? null,
    next_action: "next_action" in body ? body.next_action : automated.next_action ?? null,
    assignment_due_at: "assignment_due_at" in body ? body.assignment_due_at : automated.assignment_due_at ?? null,
    follow_up_source: "follow_up_at" in body ? (body.follow_up_at ? "manual" : null) : automated.follow_up_source ?? null,
    follow_up_created_at: automated.follow_up_created_at ?? null,
    follow_up_completed_at: null,
    priority: body.priority ?? "normal",
    review_status: body.review_status ?? "not_required",
  };

  const { data, error } = await supabase.from("applications").insert(row).select().single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Candidate already has an application for this job." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("application_events").insert({
    application_id: data.id,
    from_status: null,
    to_status: status,
    note: body.event_note ?? body.assignment_note ?? null,
  });

  return NextResponse.json(data, { status: 201 });
}
