// src/app/api/scorecard-templates/route.ts
// GET    -> list scorecard templates
// POST   -> create a template
// PATCH  -> update a template
// DELETE -> delete a template

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { query, queryOne, execute } from "@/server/db/neon";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const roleType = url.searchParams.get("roleType") || "";

  let sql = "SELECT * FROM interview_scorecard_templates";
  const params: any[] = [];
  if (roleType) {
    sql += " WHERE role_type = $1";
    params.push(roleType);
  }
  sql += " ORDER BY created_at DESC";
  const data = await query(sql, params);
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const data = await queryOne(
    `INSERT INTO interview_scorecard_templates (name, role_type, competencies, is_default) VALUES ($1, $2, $3, $4) RETURNING *`,
    [body.name, body.roleType ?? "General", body.competencies ?? [], body.isDefault ?? false]
  );
  if (!data) return NextResponse.json({ error: "Insert failed" }, { status: 500 });

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

  const keys = Object.keys(updates);
  if (keys.length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => updates[k]) as (string | number | boolean | null | Date | object)[];
  values.push(body.id);
  const data = await queryOne(
    `UPDATE interview_scorecard_templates SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
    values
  );
  if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });

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

  await execute("DELETE FROM interview_scorecard_templates WHERE id = $1", [id]);

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
