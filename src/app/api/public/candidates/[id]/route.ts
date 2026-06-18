import { NextRequest, NextResponse } from "next/server";
import { pickFields, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

const CANDIDATE_FIELDS = [
  "name", "email", "phone", "status", "target_tier", "notes", "resume_url",
  "resume_filename", "target_roles", "preferred_locations", "salary_expectation",
  "work_authorization", "avatar_url",
];

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "candidates:read");
  if (response) return response;

  const [{ data: candidate, error }, { data: applications, error: appError }] = await Promise.all([
    supabase.from("candidates").select("*").eq("id", params.id).single(),
    supabase
      .from("applications")
      .select("id, status, applied_at, follow_up_at, next_action, priority, review_status, jobs(id, title, company, location)")
      .eq("candidate_id", params.id)
      .order("applied_at", { ascending: false }),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  if (appError) return NextResponse.json({ error: appError.message }, { status: 500 });
  return NextResponse.json({ ...candidate, applications: applications ?? [] });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "candidates:write");
  if (response) return response;

  const updates = pickFields(await req.json(), CANDIDATE_FIELDS);
  const { data, error } = await supabase
    .from("candidates")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "candidates:delete");
  if (response) return response;

  const { error } = await supabase.from("candidates").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
