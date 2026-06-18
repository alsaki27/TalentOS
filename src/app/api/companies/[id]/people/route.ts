import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { normalizeCompanyName } from "@/lib/companyDirectory";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
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
      source: body.source || "manual",
      last_seen_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
