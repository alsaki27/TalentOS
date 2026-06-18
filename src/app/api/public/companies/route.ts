import { NextRequest, NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { pageParams, pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

const COMPANY_FIELDS = [
  "name", "website", "linkedin_url", "logo_url", "employees_count",
  "address", "slogan", "description", "notes", "source",
];

function companyPayload(body: any) {
  const payload = pickFields(body, COMPANY_FIELDS);
  if (typeof payload.name === "string" && payload.name.trim()) {
    const name = payload.name.trim();
    const normalizedName = normalizeCompanyName(name);
    payload.name = name;
    payload.normalized_name = normalizedName;
    payload.slug = normalizedName.replace(/\s+/g, "-");
  }
  payload.updated_at = new Date().toISOString();
  payload.last_seen_at = body.last_seen_at || new Date().toISOString();
  return payload;
}

export async function GET(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "companies:read");
  if (response) return response;

  const { url, page, pageSize, from, to } = pageParams(req, { page: 1, pageSize: 50, maxPageSize: 100 });
  const search = (url.searchParams.get("search") || "").trim();

  let query = supabase
    .from("companies")
    .select("id, name, website, linkedin_url, logo_url, employees_count, slogan, source, last_seen_at, created_at", { count: "planned" })
    .order("last_seen_at", { ascending: false });

  if (search) query = query.ilike("name", `%${search}%`);

  const { data, error, count } = await query.range(from, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "companies:write");
  if (response) return response;

  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("companies")
    .upsert(companyPayload(body), { onConflict: "normalized_name" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
