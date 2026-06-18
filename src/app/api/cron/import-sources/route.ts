// src/app/api/cron/import-sources/route.ts
// GET -> run every active saved import source (Greenhouse/Lever/Ashby/USAJobs board
// tokens, or career-page URLs) and bulk-insert new jobs. Invoked on a schedule by
// Vercel Cron (see vercel.json) — not a session-cookie route, so it checks a bearer
// secret instead. src/middleware.ts has a matching bypass for this exact path.

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { runAndRecord } from "@/lib/importSourceRunner";

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

  const { data: sources, error } = await supabase
    .from("import_sources")
    .select("*")
    .eq("is_active", true);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const source of sources ?? []) {
    const result = await runAndRecord(source);
    results.push({ id: source.id, label: source.label, ...result });
  }

  return NextResponse.json({ ranSources: results.length, results });
}
