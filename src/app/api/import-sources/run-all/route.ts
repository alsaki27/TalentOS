import { NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { runAndRecord } from "@/lib/importSourceRunner";
import { supabase } from "@/lib/supabase";

export async function POST() {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const { data: sources, error } = await supabase
    .from("import_sources")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const source of sources ?? []) {
    const result = await runAndRecord(source);
    results.push({ source_id: source.id, label: source.label, provider: source.provider, ...result });
  }

  const imported = results.reduce((sum, result) => sum + ("imported" in result ? result.imported : 0), 0);
  const skipped = results.reduce((sum, result) => sum + ("skipped" in result ? result.skipped : 0), 0);
  const failed = results.filter((result) => "error" in result).length;

  return NextResponse.json({
    ran: results.length,
    imported,
    skipped,
    failed,
    results,
  });
}
