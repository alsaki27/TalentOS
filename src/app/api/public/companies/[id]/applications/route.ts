import { NextRequest, NextResponse } from "next/server";
import { pageParams, requirePublicApiScope } from "@/lib/publicApiAuth";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requirePublicApiScope(req, "applications:read");
  if (response) return response;

  const { page, pageSize, from, to } = pageParams(req, { page: 1, pageSize: 50, maxPageSize: 100 });

  if (isNeon()) {
    const offset = from;
    const countRow = await queryOne<{ total: number }>(
      `SELECT COUNT(*)::int as total FROM applications a JOIN jobs j ON a.job_id = j.id WHERE j.company_id = $1`,
      [params.id]
    );
    const total = countRow?.total ?? 0;

    const data = await query(
      `SELECT a.*, jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email) as candidates, jsonb_build_object('id', j.id, 'title', j.title, 'company_id', j.company_id, 'company', j.company) as jobs FROM applications a JOIN candidates c ON a.candidate_id = c.id JOIN jobs j ON a.job_id = j.id WHERE j.company_id = $1 ORDER BY a.applied_at DESC OFFSET $2 LIMIT $3`,
      [params.id, offset, pageSize]
    );
    return NextResponse.json({ data: data ?? [], total, page, pageSize });
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data, error, count } = await supabase
      .from("applications")
      .select("*, candidates(id, name, email), jobs!inner(id, title, company_id, company)", { count: "planned" })
      .eq("jobs.company_id", params.id)
      .order("applied_at", { ascending: false })
      .range(from, to);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
  }
}
