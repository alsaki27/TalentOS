import { NextRequest, NextResponse } from "next/server";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

const PEOPLE_FIELDS = [
  "company_id", "full_name", "title", "linkedin_url", "photo_url", "email",
  "phone", "influence_level", "relationship_status", "notes", "source",
];

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "company_people:read");
  if (response) return response;

  const { data, error } = await supabase.from("company_people").select("*, companies(id, name)").eq("id", params.id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
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

  const { data, error } = await supabase.from("company_people").update(updates).eq("id", params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "company_people:delete");
  if (response) return response;

  const { error } = await supabase.from("company_people").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
