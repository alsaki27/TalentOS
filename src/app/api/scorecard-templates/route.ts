// src/app/api/scorecard-templates/route.ts
// GET    -> list scorecard templates
// POST   -> create a template
// PATCH  -> update a template
// DELETE -> delete a template

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const roleType = url.searchParams.get("roleType") || "";

  let query = supabase.from("interview_scorecard_templates").select("*").order("created_at", { ascending: false });
  if (roleType) query = query.eq("role_type", roleType);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("interview_scorecard_templates")
    .insert({
      name: body.name,
      role_type: body.roleType ?? "General",
      competencies: body.competencies ?? [],
      is_default: body.isDefault ?? false,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email || undefined,
    type: "create",
    description: `Created scorecard template: ${body.name}`,
    entityType: "scorecard_template",
    entityId: data.id,
    entityName: body.name,
  });

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const allowedFields = ["name", "role_type", "competencies", "is_default"];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  const { data, error } = await supabase
    .from("interview_scorecard_templates")
    .update(updates)
    .eq("id", body.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email || undefined,
    type: "update",
    description: `Updated scorecard template ${body.id}`,
    entityType: "scorecard_template",
    entityId: body.id,
    metadata: { fields: Object.keys(updates) },
  });

  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  }

  const { error } = await supabase.from("interview_scorecard_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email || undefined,
    type: "delete",
    description: `Deleted scorecard template ${id}`,
    entityType: "scorecard_template",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}
