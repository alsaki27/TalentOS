// src/app/api/ops/status/route.ts
// GET -> admin-only system health snapshot: live Supabase reachability + latency,
// row counts, and recent import run history/errors. Built directly out of this
// session's pain (an hour-long Supabase outage plus a wiped jobs table went
// undetected until someone happened to check manually) — give that an obvious place
// to surface next time instead.
//
// Phase 3 addition: per-category AI provider status, showing which provider is
// active for each task category and whether it's an explicit override or just
// inheriting the global default chain.

import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";
import { getProviderForCategory } from "@/lib/ai";

export const dynamic = "force-dynamic";

const CATEGORIES = [
  "resume_studio",
  "chat_assistant",
  "parsing_extraction",
  "content_generation",
  "default",
] as const;

export async function GET() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  let supabaseLatencyMs: number;
  let pingError: any;
  let candidatesCount: number;
  let jobsCount: number;
  let applicationsCount: number;
  let resumesCount: number;
  let recentRuns: any[];
  let sources: any[];

  // Per-category AI provider status
  const categoryStatuses: Record<string, { configured: boolean; provider: string | null; source: string }> = {};
  let overrideCategories: Set<string> = new Set();

  if (isNeon()) {
    const rows = await query<{ category: string }>(
      `SELECT category FROM ai_task_category_config WHERE provider IS NOT NULL OR ai_key_id IS NOT NULL`,
      []
    );
    for (const r of rows) overrideCategories.add(r.category);
  } else {
    const { data } = await supabase
      .from("ai_task_category_config")
      .select("category")
      .or("provider.not.is.null,ai_key_id.not.is.null");
    for (const r of data ?? []) overrideCategories.add(r.category);
  }

  for (const cat of CATEGORIES) {
    const provider = await getProviderForCategory(cat);
    categoryStatuses[cat] = {
      configured: Boolean(provider),
      provider: provider?.name ?? null,
      source: overrideCategories.has(cat) ? "override" : "default_chain",
    };
  }

  const activeProvider = categoryStatuses["default"];

  if (isNeon()) {
    const pingStart = Date.now();
    try {
      await queryOne('SELECT id FROM candidates LIMIT 1', []);
      pingError = null;
    } catch (err: any) {
      pingError = { message: err.message };
    }
    supabaseLatencyMs = Date.now() - pingStart;

    const [candidatesRes, jobsRes, applicationsRes, resumesRes] = await Promise.all([
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM candidates', []),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM jobs', []),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM applications', []),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM resumes', []),
    ]);

    candidatesCount = parseInt(candidatesRes?.count ?? '0', 10);
    jobsCount = parseInt(jobsRes?.count ?? '0', 10);
    applicationsCount = parseInt(applicationsRes?.count ?? '0', 10);
    resumesCount = parseInt(resumesRes?.count ?? '0', 10);

    recentRuns = await query(
      'SELECT id, import_source_id, imported, skipped, error, ran_at FROM import_runs ORDER BY ran_at DESC LIMIT $1',
      [10]
    );
    sources = await query(
      'SELECT id, label, is_active, last_run_at, last_result FROM import_sources',
      []
    );
  } else {
    const pingStart = Date.now();
    const { error: pingErrorRes } = await supabase.from("candidates").select("id", { head: true, count: "exact" });
    supabaseLatencyMs = Date.now() - pingStart;
    pingError = pingErrorRes;

    const [candidatesRes, jobsRes, applicationsRes, resumesRes] = await Promise.all([
      supabase.from("candidates").select("id", { count: "exact", head: true }),
      supabase.from("jobs").select("id", { count: "exact", head: true }),
      supabase.from("applications").select("id", { count: "exact", head: true }),
      supabase.from("resumes").select("id", { count: "exact", head: true }),
    ]);

    candidatesCount = candidatesRes.count ?? 0;
    jobsCount = jobsRes.count ?? 0;
    applicationsCount = applicationsRes.count ?? 0;
    resumesCount = resumesRes.count ?? 0;

    // import_runs/import_sources may not exist yet if that migration hasn't been pushed —
    // degrade gracefully rather than failing the whole health check over it.
    const [recentRunsRes, sourcesRes] = await Promise.all([
      supabase.from("import_runs").select("id, import_source_id, imported, skipped, error, ran_at").order("ran_at", { ascending: false }).limit(10),
      supabase.from("import_sources").select("id, label, is_active, last_run_at, last_result"),
    ]);

    recentRuns = recentRunsRes.data ?? [];
    sources = sourcesRes.data ?? [];
  }

  return NextResponse.json({
    supabase: {
      healthy: !pingError,
      latencyMs: supabaseLatencyMs,
      error: pingError?.message ?? null,
    },
    counts: {
      candidates: candidatesCount,
      jobs: jobsCount,
      applications: applicationsCount,
      resumes: resumesCount,
    },
    recentImportRuns: recentRuns,
    importSources: sources,
    aiAssistant: {
      default: {
        configured: activeProvider.configured,
        provider: activeProvider.provider,
        source: activeProvider.source,
      },
      categories: {
        resume_studio: categoryStatuses["resume_studio"],
        chat_assistant: categoryStatuses["chat_assistant"],
        parsing_extraction: categoryStatuses["parsing_extraction"],
        content_generation: categoryStatuses["content_generation"],
      },
    },
  });
}
