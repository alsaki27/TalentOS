// src/app/api/applications/[id]/route.ts
// PATCH  -> update an application's status/notes
// DELETE -> remove an application (and its status-change history)

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();

  const allowedFields = [
    "status", "notes", "resume_url", "resume_filename", "resume_id",
    "follow_up_at", "next_action", "assigned_by", "assigned_to",
    "assignment_note", "assignment_due_at", "completed_at",
  ];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  let previousStatus: string | null = null;
  if ("status" in updates) {
    const { data: current } = await supabase
      .from("applications")
      .select("status")
      .eq("id", params.id)
      .single();
    previousStatus = current?.status ?? null;
  }

  const { data, error } = await supabase
    .from("applications")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

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

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await supabase.from("applications").delete().eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
