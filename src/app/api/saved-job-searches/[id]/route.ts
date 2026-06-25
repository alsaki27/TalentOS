import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { queryOne, execute } from "@/server/db/neon";

const ALLOWED_FILTERS = [
  "search",
  "source",
  "roleTier",
  "active",
  "employmentType",
  "category",
  "workAuthorization",
  "dateStart",
  "dateEnd",
  "candidate",
  "assignedBy",
  "owner",
  "score",
  "sort",
] as const;

function cleanFilters(input: unknown) {
  const raw = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const filters: Record<string, string> = {};
  for (const key of ALLOWED_FILTERS) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) filters[key] = value.trim();
  }
  return filters;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("label" in body) {
    const label = body.label?.trim();
    if (!label) return NextResponse.json({ error: "label cannot be empty" }, { status: 400 });
    updates.label = label;
  }
  if ("filters" in body) {
    const filters = cleanFilters(body.filters);
    if (Object.keys(filters).length === 0) {
      return NextResponse.json({ error: "Save at least one active filter." }, { status: 400 });
    }
    updates.filters = filters;
  }
  if ("is_shared" in body) updates.is_shared = body.is_shared !== false;

  if (isNeon()) {
    const entries = Object.entries(updates);
    const setClauses = entries.map(([key], i) => `${key} = $${i + 1}`);
    const sqlParams = entries.map(([, val]) => val);
    sqlParams.push(params.id);
    const data = await queryOne<any>(`UPDATE saved_job_searches SET ${setClauses.join(", ")} WHERE id = $${sqlParams.length} RETURNING *`, sqlParams);
    return NextResponse.json(data);
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("saved_job_searches")
      .update(updates)
      .eq("id", params.id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  if (isNeon()) {
    await execute(`DELETE FROM saved_job_searches WHERE id = $1`, [params.id]);
    return NextResponse.json({ ok: true });
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { error } = await supabase
      .from("saved_job_searches")
      .delete()
      .eq("id", params.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
}
