// src/app/api/import/normalize/commit/route.ts
// POST -> re-parse the file, apply the (possibly user-adjusted) field mapping, clean,
// dedupe (with fuzzy title+company+location fallback for rows with no source_url),
// and insert into jobs. Optionally saves/updates a named import profile.

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { detectFormat } from "@/lib/normalizer/detect";
import { parseTable } from "@/lib/normalizer/parse";
import { applyMapping, FieldMapping } from "@/lib/normalizer";
import { enrichExistingJobsBySourceUrl, filterNewJobsWithFuzzyFallback } from "@/lib/jobDedup";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const filename = body.filename as string | undefined;
  const content = body.content as string | undefined;
  const mapping = body.mapping as FieldMapping | undefined;
  const profileLabel = body.profileLabel as string | undefined;
  const sourceLabel = body.sourceLabel as string | undefined;

  if (!filename || !content || !mapping) {
    return NextResponse.json({ error: "filename, content, and mapping are required" }, { status: 400 });
  }
  if (!mapping.title) {
    return NextResponse.json({ error: "the title field must be mapped to a column" }, { status: 400 });
  }

  let table;
  try {
    table = parseTable(detectFormat(filename, content), content);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "failed to parse file" }, { status: 400 });
  }

  const cleaned = applyMapping(table.rows, mapping);

  if (cleaned.length === 0) {
    return NextResponse.json({ imported: 0, skipped: table.rows.length });
  }

  const rowsToInsert = cleaned.map((row) => ({
    ...row,
    source: sourceLabel?.trim() || "normalized_import",
  }));
  await enrichExistingJobsBySourceUrl(rowsToInsert);
  const { newRows, duplicates } = await filterNewJobsWithFuzzyFallback(rowsToInsert);

  let imported = 0;
  if (newRows.length > 0) {
    const { data, error } = await supabase.from("jobs").insert(newRows).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    imported = data.length;
  }

  if (profileLabel) {
    const { error } = await supabase
      .from("import_profiles")
      .insert({ label: profileLabel.trim(), column_map: mapping });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    imported,
    skipped: table.rows.length - cleaned.length + duplicates,
  });
}
