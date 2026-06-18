import { NextRequest, NextResponse } from "next/server";
import { pageParams, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "reminders:read");
  if (response) return response;

  const { url, page, pageSize, from, to } = pageParams(req, { page: 1, pageSize: 50, maxPageSize: 100 });
  const due = url.searchParams.get("due") || "";
  const today = new Date().toISOString().slice(0, 10);

  let query = supabase
    .from("applications")
    .select("id, status, follow_up_at, follow_up_source, follow_up_created_at, follow_up_completed_at, next_action, assigned_to, assigned_to_user_id, candidates(id, name), jobs(id, title, company)", { count: "planned" })
    .not("follow_up_at", "is", null)
    .order("follow_up_at", { ascending: true });

  if (due === "today") query = query.lte("follow_up_at", today);
  if (due === "upcoming") query = query.gt("follow_up_at", today);

  const { data, error, count } = await query.range(from, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "reminders:write");
  if (response) return response;

  const body = await req.json();
  if (!body.application_id || !body.follow_up_at) {
    return NextResponse.json({ error: "application_id and follow_up_at are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("applications")
    .update({
      follow_up_at: body.follow_up_at,
      next_action: body.next_action || null,
      follow_up_source: body.follow_up_source || "public_api",
      follow_up_created_at: new Date().toISOString(),
      follow_up_completed_at: null,
    })
    .eq("id", body.application_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
