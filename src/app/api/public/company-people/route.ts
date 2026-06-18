import { NextRequest, NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { pageParams, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "company_people:read");
  if (response) return response;

  const { url, page, pageSize, from, to } = pageParams(req, { page: 1, pageSize: 50, maxPageSize: 100 });
  const companyId = url.searchParams.get("company_id") || "";
  const search = (url.searchParams.get("search") || "").trim();

  let query = supabase
    .from("company_people")
    .select("*, companies(id, name)", { count: "planned" })
    .order("last_seen_at", { ascending: false });

  if (companyId) query = query.eq("company_id", companyId);
  if (search) query = query.or(`full_name.ilike.%${search}%,title.ilike.%${search}%,email.ilike.%${search}%`);

  const { data, error, count } = await query.range(from, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "company_people:write");
  if (response) return response;

  const body = await req.json();
  const fullName = String(body.full_name ?? "").trim();
  if (!fullName || !body.company_id) return NextResponse.json({ error: "company_id and full_name are required" }, { status: 400 });

  const { data, error } = await supabase
    .from("company_people")
    .insert({
      company_id: body.company_id,
      full_name: fullName,
      normalized_name: normalizeCompanyName(fullName),
      title: body.title || null,
      linkedin_url: body.linkedin_url || null,
      photo_url: body.photo_url || null,
      email: body.email || null,
      phone: body.phone || null,
      influence_level: body.influence_level || "unknown",
      relationship_status: body.relationship_status || "new",
      notes: body.notes || null,
      source: body.source || "public_api",
      last_seen_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
