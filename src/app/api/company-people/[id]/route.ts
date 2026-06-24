import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { queryOne, execute } from "@/server/db/neon";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const allowed = [
    "full_name", "title", "linkedin_url", "photo_url", "email", "phone",
    "influence_level", "relationship_status", "notes", "source",
  ];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const field of allowed) {
    if (field in body) updates[field] = body[field] || null;
  }
  if (typeof updates.full_name === "string" && updates.full_name.trim()) {
    const fullName = updates.full_name.trim();
    updates.full_name = fullName;
    updates.normalized_name = normalizeCompanyName(fullName);
  }

  if (isNeon()) {
    const keys = Object.keys(updates);
    if (keys.length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = keys.map((k) => updates[k]) as (string | number | boolean | null | Date | object)[];
    values.push(params.id);
    const data = await queryOne(
      `UPDATE company_people SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      values
    );
    if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });
    return NextResponse.json(data);
  }

  const { data, error } = await supabase
    .from("company_people")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  if (isNeon()) {
    await execute("DELETE FROM company_people WHERE id = $1", [params.id]);
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase.from("company_people").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
