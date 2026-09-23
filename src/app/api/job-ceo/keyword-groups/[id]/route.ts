import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query, execute } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  let body: { label?: string; keywords?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (body.label !== undefined) {
    sets.push(`label = $${idx}`);
    values.push(body.label.trim());
    idx++;
  }
  if (body.keywords !== undefined) {
    const clean = body.keywords.map((k) => k.trim()).filter(Boolean);
    if (clean.length === 0) {
      return NextResponse.json({ error: "keywords must not be empty" }, { status: 400 });
    }
    sets.push(`keywords = $${idx}`);
    values.push(JSON.stringify(clean));
    idx++;
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  values.push(params.id);
  try {
    const rows = await query(
      `UPDATE job_agent_keyword_groups SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!rows.length) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not update keyword group" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  try {
    await execute("DELETE FROM job_agent_keyword_groups WHERE id = $1", [params.id]);
    return NextResponse.json({ deleted: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not delete keyword group" }, { status: 500 });
  }
}
