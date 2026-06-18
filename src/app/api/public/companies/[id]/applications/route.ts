import { NextRequest, NextResponse } from "next/server";
import { pageParams, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "applications:read");
  if (response) return response;

  const { page, pageSize, from, to } = pageParams(req, { page: 1, pageSize: 50, maxPageSize: 100 });
  const { data, error, count } = await supabase
    .from("applications")
    .select("*, candidates(id, name, email), jobs!inner(id, title, company_id, company)", { count: "planned" })
    .eq("jobs.company_id", params.id)
    .order("applied_at", { ascending: false })
    .range(from, to);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
}
