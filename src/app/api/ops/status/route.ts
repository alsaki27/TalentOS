// src/app/api/ops/status/route.ts
// GET -> admin-only system health snapshot: live Supabase reachability + latency,
// row counts, and recent import run history/errors. Built directly out of this
// session's pain (an hour-long Supabase outage plus a wiped jobs table went
// undetected until someone happened to check manually) — give that an obvious place
// to surface next time instead.

import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getActiveProvider } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const pingStart = Date.now();
  const { error: pingError } = await supabase.from("candidates").select("id", { head: true, count: "exact" });
  const supabaseLatencyMs = Date.now() - pingStart;

  const [candidatesRes, jobsRes, applicationsRes, resumesRes] = await Promise.all([
    supabase.from("candidates").select("id", { count: "exact", head: true }),
    supabase.from("jobs").select("id", { count: "exact", head: true }),
    supabase.from("applications").select("id", { count: "exact", head: true }),
    supabase.from("resumes").select("id", { count: "exact", head: true }),
  ]);

  // import_runs/import_sources may not exist yet if that migration hasn't been pushed —
  // degrade gracefully rather than failing the whole health check over it.
  const [recentRunsRes, sourcesRes] = await Promise.all([
    supabase.from("import_runs").select("id, import_source_id, imported, skipped, error, ran_at").order("ran_at", { ascending: false }).limit(10),
    supabase.from("import_sources").select("id, label, is_active, last_run_at, last_result"),
  ]);

  return NextResponse.json({
    supabase: {
      healthy: !pingError,
      latencyMs: supabaseLatencyMs,
      error: pingError?.message ?? null,
    },
    counts: {
      candidates: candidatesRes.count ?? 0,
      jobs: jobsRes.count ?? 0,
      applications: applicationsRes.count ?? 0,
      resumes: resumesRes.count ?? 0,
    },
    recentImportRuns: recentRunsRes.data ?? [],
    importSources: sourcesRes.data ?? [],
    aiAssistant: {
      configured: Boolean(getActiveProvider()),
      provider: getActiveProvider()?.name ?? null,
    },
  });
}
