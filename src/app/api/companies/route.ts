import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const search = (url.searchParams.get("search") || "").trim();
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("companies")
    .select("id, name, website, linkedin_url, logo_url, employees_count, slogan, source, last_seen_at, jobs(id), company_people(id)", { count: "planned" })
    .order("last_seen_at", { ascending: false });

  if (search) query = query.ilike("name", `%${search}%`);

  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    companies: (data ?? []).map((company: any) => ({
      ...company,
      job_count: company.jobs?.length ?? 0,
      people_count: company.company_people?.length ?? 0,
    })),
    total: count ?? 0,
    page,
    pageSize,
  });
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const normalizedName = normalizeCompanyName(name);
  const { data, error } = await supabase
    .from("companies")
    .upsert({
      name,
      normalized_name: normalizedName,
      slug: normalizedName.replace(/\s+/g, "-"),
      website: body.website || null,
      linkedin_url: body.linkedin_url || null,
      logo_url: body.logo_url || null,
      employees_count: body.employees_count || null,
      slogan: body.slogan || null,
      description: body.description || null,
      notes: body.notes || null,
      source: body.source || "manual",
      updated_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "normalized_name" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
