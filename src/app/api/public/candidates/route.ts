import { NextRequest, NextResponse } from "next/server";
import { pageParams, pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

const CANDIDATE_FIELDS = [
  "name", "email", "phone", "status", "target_tier", "notes", "resume_url",
  "resume_filename", "target_roles", "preferred_locations", "salary_expectation",
  "work_authorization", "avatar_url",
];

export async function GET(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "candidates:read");
  if (response) return response;

  const { url, page, pageSize, from, to } = pageParams(req);
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const status = url.searchParams.get("status") || "";
  const targetTier = url.searchParams.get("target_tier") || "";

  let query = supabase
    .from("candidates")
    .select("id, name, email, phone, status, target_tier, target_roles, preferred_locations, salary_expectation, work_authorization, resume_url, resume_filename, avatar_url, created_at", { count: "planned" })
    .order("created_at", { ascending: false });

  if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,target_roles.ilike.%${search}%`);
  if (status) query = query.eq("status", status);
  if (targetTier) query = query.eq("target_tier", targetTier);

  const { data, error, count } = await query.range(from, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "candidates:write");
  if (response) return response;

  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("candidates")
    .insert({
      ...pickFields(body, CANDIDATE_FIELDS),
      status: body.status ?? "active",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
