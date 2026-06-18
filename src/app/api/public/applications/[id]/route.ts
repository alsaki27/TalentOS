import { NextRequest, NextResponse } from "next/server";
import { applicationAutomation } from "@/lib/applicationAutomation";
import { pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

const APPLICATION_FIELDS = [
  "status", "notes", "resume_url", "resume_filename", "resume_id",
  "follow_up_at", "follow_up_source", "follow_up_completed_at", "next_action",
  "assigned_by", "assigned_to", "assigned_by_user_id", "assigned_to_user_id",
  "assignment_note", "assignment_due_at", "completed_at", "priority",
  "review_status", "review_note", "reviewed_by_user_id", "reviewed_at",
];

const ASSIGNMENT_FIELDS = [
  "assigned_by", "assigned_to", "assigned_by_user_id", "assigned_to_user_id",
  "assignment_note", "assignment_due_at", "priority", "review_status",
  "review_note", "reviewed_by_user_id", "reviewed_at",
];

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "applications:read");
  if (response) return response;

  const { data, error } = await supabase
    .from("applications")
    .select("*, candidates(id, name, email), jobs(id, title, company, location)")
    .eq("id", params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const touchesStatus = "status" in body;
  const touchesAssignment = ASSIGNMENT_FIELDS.some((field) => field in body);

  const baseAuth = await requirePublicApiScope(req, "applications:write");
  if (baseAuth.response) return baseAuth.response;
  if (touchesStatus) {
    const statusAuth = await requirePublicApiScope(req, "applications:status");
    if (statusAuth.response) return statusAuth.response;
  }
  if (touchesAssignment) {
    const assignmentAuth = await requirePublicApiScope(req, "applications:assign");
    if (assignmentAuth.response) return assignmentAuth.response;
  }

  const updates = pickFields(body, APPLICATION_FIELDS);
  if ("follow_up_at" in updates) {
    updates.follow_up_source = body.follow_up_source ?? (updates.follow_up_at ? "manual" : null);
    updates.follow_up_created_at = updates.follow_up_at ? new Date().toISOString() : null;
    updates.follow_up_completed_at = updates.follow_up_at ? null : new Date().toISOString();
  }

  let previousStatus: string | null = null;
  if ("status" in updates) {
    const { data: current } = await supabase.from("applications").select("status").eq("id", params.id).single();
    previousStatus = current?.status ?? null;
    const automated = applicationAutomation({
      status: String(updates.status),
      explicitFollowUp: "follow_up_at" in body,
      explicitNextAction: "next_action" in body,
      explicitAssignmentDue: "assignment_due_at" in body,
    });
    for (const [key, value] of Object.entries(automated)) {
      if (!(key in updates)) updates[key] = value;
    }
  }

  const { data, error } = await supabase.from("applications").update(updates).eq("id", params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if ("status" in updates && updates.status !== previousStatus) {
    await supabase.from("application_events").insert({
      application_id: params.id,
      from_status: previousStatus,
      to_status: updates.status,
      note: body.event_note ?? null,
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "applications:assign");
  if (response) return response;

  const { error } = await supabase.from("applications").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
