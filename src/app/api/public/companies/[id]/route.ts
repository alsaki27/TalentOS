import { NextRequest, NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

const COMPANY_FIELDS = [
  "name", "website", "linkedin_url", "logo_url", "employees_count",
  "address", "slogan", "description", "notes", "source",
];

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "companies:read");
  if (response) return response;

  const [{ data: company, error }, { data: jobs }, { data: people }, { data: applications }] = await Promise.all([
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

  const { data, error } = await supabase.from("companies").update(updates).eq("id", params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "companies:delete");
  if (response) return response;

  const { error } = await supabase.from("companies").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
