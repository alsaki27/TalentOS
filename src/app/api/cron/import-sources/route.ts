// src/app/api/cron/import-sources/route.ts
// GET -> run every active saved import source (Greenhouse/Lever/Ashby/USAJobs board
// tokens, or career-page URLs) and bulk-insert new jobs. Invoked on a schedule by
// Vercel Cron (see vercel.json) — not a session-cookie route, so it checks a bearer
// secret instead. src/middleware.ts has a matching bypass for this exact path.

import { NextRequest, NextResponse } from "next/server";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";
import { runAndRecord } from "@/lib/importSourceRunner";
import { recordJobAttempt, recordJobSuccess, recordJobFailure } from "@/server/services/scheduledJobService";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedMs = Date.now();
  await recordJobAttempt("import-sources");

  let sources: any[] = [];
  if (isNeon()) {
    sources = await query<any>(`SELECT * FROM import_sources WHERE is_active = true`);
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("import_sources")
      .select("*")
      .eq("is_active", true);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    sources = data ?? [];
  }

  const results = [];
  let totalImported = 0;
  let totalSkipped = 0;
  let hasErrors = false;

  for (const source of sources) {
    const result = await runAndRecord(source);
    results.push({ id: source.id, label: source.label, ...result });
    if ("error" in result) {
      hasErrors = true;
    } else {
      totalImported += result.imported;
      totalSkipped += result.skipped;
    }
  }

  const durationMs = Date.now() - startedMs;
  const summary = JSON.stringify({ totalImported, totalSkipped, sourcesRan: results.length });
  if (hasErrors) {
    await recordJobFailure("import-sources", "One or more sources had errors", durationMs);
  } else {
    await recordJobSuccess("import-sources", durationMs, summary);
  }

  return NextResponse.json({ ranSources: results.length, results });
}
