import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "25", 10) || 25));

  let data: any;
  let error: any;

  if (isNeon()) {
    try {
      data = await query(
        `SELECT ir.id, ir.import_source_id, ir.imported, ir.skipped, ir.error, ir.ran_at,
          CASE WHEN s.id IS NOT NULL THEN jsonb_build_object('label', s.label, 'provider', s.provider) END AS "import_sources"
        FROM import_runs ir
        LEFT JOIN import_sources s ON s.id = ir.import_source_id
        ORDER BY ir.ran_at DESC
        LIMIT $1`,
        [limit]
      );
      error = null;
    } catch (err: any) {
      error = { message: err.message };
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("import_runs")
      .select("id, import_source_id, imported, skipped, error, ran_at, import_sources(label, provider)")
      .order("ran_at", { ascending: false })
      .limit(limit);
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
