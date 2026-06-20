import { NextRequest, NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

const COMPANY_FIELDS = [
  "name", "website", "linkedin_url", "logo_url", "employees_count",
  "address", "slogan", "description", "notes", "source",
];

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "companies:read");
  if (response) return response;

  let company: any;
  let jobs: any[];
  let people: any[];
  let applications: any[];
  let error: any;

  if (isNeon()) {
    company = await queryOne('SELECT * FROM companies WHERE id = $1', [params.id]);
    jobs = await query(
      'SELECT id, title, location, source, posted_at, is_active, job_category FROM jobs WHERE company_id = $1 LIMIT $2',
      [params.id, 100]
    );
    people = await query(
      'SELECT * FROM company_people WHERE company_id = $1 ORDER BY last_seen_at DESC LIMIT $2',
      [params.id, 100]
    );
    applications = await query(
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
    error = company ? null : { message: 'Not found' };
  } else {
    const [companyRes, jobsRes, peopleRes, applicationsRes] = await Promise.all([
      supabase.from("companies").select("*").eq("id", params.id).single(),
      supabase.from("jobs").select("id, title, location, source, posted_at, is_active, job_category").eq("company_id", params.id).limit(100),
      supabase.from("company_people").select("*").eq("company_id", params.id).order("last_seen_at", { ascending: false }).limit(100),
      supabase
        .from("applications")
        .select("id, status, applied_at, follow_up_at, candidates(id, name), jobs!inner(id, title, company_id)")
        .eq("jobs.company_id", params.id)
        .order("applied_at", { ascending: false })
        .limit(100),
    ]);

    company = companyRes.data;
    jobs = jobsRes.data ?? [];
    people = peopleRes.data ?? [];
    applications = applicationsRes.data ?? [];
    error = companyRes.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
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

  let data: any;
  let error: any;

  if (isNeon()) {
    const keys = Object.keys(updates);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = [...keys.map((k) => updates[k]), params.id] as (string | number | boolean | object | Date | null)[];
    data = await queryOne(
      `UPDATE companies SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      values
    );
    error = data ? null : { message: 'Update failed' };
  } else {
    const res = await supabase.from("companies").update(updates).eq("id", params.id).select().single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "companies:delete");
  if (response) return response;

  let error: any;

  if (isNeon()) {
    const res = await execute('DELETE FROM companies WHERE id = $1', [params.id]);
    error = res.rowCount === 0 ? { message: 'Not found' } : null;
  } else {
    const res = await supabase.from("companies").delete().eq("id", params.id);
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
