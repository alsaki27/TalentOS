import { NextRequest, NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { queryOne, execute } from "@/server/db/neon";

const PEOPLE_FIELDS = [
  "company_id", "full_name", "title", "linkedin_url", "photo_url", "email",
  "phone", "influence_level", "relationship_status", "notes", "source",
];

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "company_people:read");
  if (response) return response;

  const data = await queryOne(
    `SELECT cp.*, jsonb_build_object('id', c.id, 'name', c.name) as companies
     FROM company_people cp
     LEFT JOIN companies c ON cp.company_id = c.id
     WHERE cp.id = $1`,
    [params.id]
  );
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "company_people:write");
  if (response) return response;

  const updates = pickFields(await req.json(), PEOPLE_FIELDS);
  if (typeof updates.full_name === "string" && updates.full_name.trim()) {
    const fullName = updates.full_name.trim();
    updates.full_name = fullName;
    updates.normalized_name = normalizeCompanyName(fullName);
  }
  updates.updated_at = new Date().toISOString();
  updates.last_seen_at = new Date().toISOString();

  const keys = Object.keys(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = [...keys.map((k) => updates[k]), params.id] as (string | number | boolean | object | Date | null)[];
  const data = await queryOne(
    `UPDATE company_people SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
    values
  );
  if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "company_people:delete");
  if (response) return response;

  const res = await execute('DELETE FROM company_people WHERE id = $1', [params.id]);
  if (res.rowCount === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
