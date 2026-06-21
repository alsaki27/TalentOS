// src/app/api/interviews/[id]/panel/route.ts
// POST   -> add a panel member to an interview
// DELETE -> remove a panel member

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isNeon } from "@/server/db";
import { queryOne, execute } from "@/server/db/neon";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  if (!body.interviewerId) {
    return NextResponse.json({ error: "interviewerId is required" }, { status: 400 });
  }

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await queryOne(
      `INSERT INTO interview_panel_members (schedule_id, interviewer_id, role, status) VALUES ($1, $2, $3, $4) RETURNING *`,
      [params.id, body.interviewerId, body.role ?? "interviewer", "pending"]
    );
    error = data ? null : { message: "Insert failed" };
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("interview_panel_members")
      .insert({
        schedule_id: params.id,
        interviewer_id: body.interviewerId,
        role: body.role ?? "interviewer",
        status: "pending",
      })
      .select()
      .single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email || undefined,
    type: "create",
    description: `Added panel member to interview ${params.id}`,
    entityType: "interview_panel",
    entityId: data.id,
    metadata: { interviewer_id: body.interviewerId, role: body.role },
  });

  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const url = new URL(req.url);
  const panelMemberId = url.searchParams.get("panelMemberId");
  if (!panelMemberId) {
    return NextResponse.json({ error: "panelMemberId query param is required" }, { status: 400 });
  }

  let error: any;

  if (isNeon()) {
    const res = await execute(
      "DELETE FROM interview_panel_members WHERE id = $1 AND schedule_id = $2",
      [panelMemberId, params.id]
    );
    error = res.rowCount === 0 ? { message: "Not found" } : null;
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("interview_panel_members")
      .delete()
      .eq("id", panelMemberId)
      .eq("schedule_id", params.id);
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email || undefined,
    type: "delete",
    description: `Removed panel member from interview ${params.id}`,
    entityType: "interview_panel",
    entityId: panelMemberId,
  });

  return NextResponse.json({ ok: true });
}
