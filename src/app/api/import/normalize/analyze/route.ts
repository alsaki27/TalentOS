// src/app/api/import/normalize/analyze/route.ts
// POST -> detect format, parse, and heuristically map fields for a file the user is
// about to import. Returns a preview + suggested mapping for the UI to confirm/adjust
// before calling /commit. Does not touch the database.

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { analyzeFile } from "@/lib/normalizer";
import { supabase } from "@/lib/supabase";

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function headerOverlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const left = new Set(a.map(normalizeHeader));
  const right = new Set(b.map(normalizeHeader));
  let overlap = 0;
  left.forEach((h) => { if (right.has(h)) overlap++; });
  return overlap / Math.max(left.size, right.size);
}

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const filename = body.filename as string | undefined;
  const content = body.content as string | undefined;

  if (!filename || !content) {
    return NextResponse.json({ error: "filename and content are required" }, { status: 400 });
  }

  let result;
  try {
    result = analyzeFile(filename, content);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "failed to parse file" }, { status: 400 });
  }

  const { data: profiles } = await supabase
    .from("import_profiles")
    .select("id, label, column_map")
    .order("created_at", { ascending: false });

  const matchingProfiles = (profiles ?? [])
    .map((profile) => ({
      id: profile.id,
      label: profile.label,
      column_map: profile.column_map,
      score: headerOverlapScore(result.rawHeaders, Object.values(profile.column_map ?? {}) as string[]),
    }))
    .filter((profile) => profile.score >= 0.7)
    .sort((a, b) => b.score - a.score);

  return NextResponse.json({
    headersDetected: result.headersDetected,
    mapping: result.mapping,
    unmappedHeaders: result.unmappedHeaders,
    confident: result.confident,
    rawHeaders: result.rawHeaders,
    sampleRows: result.sampleRows,
    matchingProfiles,
    rowCount: result.rows.length,
  });
}
