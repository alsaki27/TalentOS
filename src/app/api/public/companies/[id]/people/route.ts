import { NextRequest, NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { pageParams, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "company_people:read");
  if (response) return response;

  const { page, pageSize, from, to } = pageParams(req, { page: 1, pageSize: 50, maxPageSize: 100 });
  const { data, error, count } = await supabase
    .from("company_people")
    .select("*", { count: "planned" })
    .eq("company_id", params.id)
    .order("last_seen_at", { ascending: false })
    .range(from, to);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "company_people:write");
  if (response) return response;

  const body = await req.json();
  const fullName = String(body.full_name ?? "").trim();
  if (!fullName) return NextResponse.json({ error: "full_name is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("company_people")
    .insert({
      company_id: params.id,
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
