import { NextRequest, NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { query, queryOne, execute } from "@/server/db/neon";

const COMPANY_FIELDS = [
  "name", "website", "linkedin_url", "logo_url", "employees_count",
  "address", "slogan", "description", "notes", "source",
];

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "companies:read");
  if (response) return response;

  const company = await queryOne('SELECT * FROM companies WHERE id = $1', [params.id]);
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const jobs = await query(
    'SELECT id, title, location, source, posted_at, is_active, job_category FROM jobs WHERE company_id = $1 LIMIT $2',
    [params.id, 100]
  );
  const people = await query(
    'SELECT * FROM company_people WHERE company_id = $1 ORDER BY last_seen_at DESC LIMIT $2',
    [params.id, 100]
  );
  const applications = await query(
    `SELECT a.id, a.status, a.applied_at, a.follow_up_at,
      jsonb_build_object('id', c.id, 'name', c.name) as candidates,
      jsonb_build_object('id', j.id, 'title', j.title) as jobs
     FROM applications a
     JOIN candidates c ON a.candidate_id = c.id
     JOIN jobs j ON a.job_id = j.id
     WHERE j.company_id = $1
     ORDER BY a.applied_at DESC
     LIMIT $2`,
    [params.id, 100]
  );

  return NextResponse.json({ ...company, jobs: jobs ?? [], people: people ?? [], applications: applications ?? [] });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "companies:write");
  if (response) return response;

  const body = await req.json();
  const updates = pickFields(body, COMPANY_FIELDS);
  if (typeof updates.name === "string" && updates.name.trim()) {
    const name = updates.name.trim();
    const normalizedName = normalizeCompanyName(name);
    updates.name = name;
    updates.normalized_name = normalizedName;
    updates.slug = normalizedName.replace(/\s+/g, "-");
  }
  updates.updated_at = new Date().toISOString();

  const keys = Object.keys(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = [...keys.map((k) => updates[k]), params.id] as (string | number | boolean | object | Date | null)[];
  const data = await queryOne(
    `UPDATE companies SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
    values
  );

  if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "companies:delete");
  if (response) return response;

  const res = await execute('DELETE FROM companies WHERE id = $1', [params.id]);
  if (res.rowCount === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
