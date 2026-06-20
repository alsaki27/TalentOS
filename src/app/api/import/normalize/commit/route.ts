// src/app/api/import/normalize/commit/route.ts
// POST -> re-parse the file, apply the (possibly user-adjusted) field mapping, clean,
// dedupe (with fuzzy title+company+location fallback for rows with no source_url),
// and insert into jobs. Optionally saves/updates a named import profile.

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, execute } from "@/server/db/neon";
import { detectFormat } from "@/lib/normalizer/detect";
import { parseTable } from "@/lib/normalizer/parse";
import { applyMapping, FieldMapping } from "@/lib/normalizer";
import { enrichExistingJobsBySourceUrl, filterNewJobsWithFuzzyFallback } from "@/lib/jobDedup";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

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
    let data: any[];
    let error: any;

    if (isNeon()) {
      const cols = Object.keys(newRows[0]);
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIdx = 1;
      for (const row of newRows) {
        const rowPlaceholders: string[] = [];
        for (const col of cols) {
          rowPlaceholders.push(`$${paramIdx++}`);
          values.push((row as any)[col]);
        }
        placeholders.push(`(${rowPlaceholders.join(", ")})`);
      }
      const sql = `INSERT INTO jobs (${cols.join(", ")}) VALUES ${placeholders.join(", ")} RETURNING *`;
      data = await query(sql, values);
      error = null;
    } else {
      const res = await supabase.from("jobs").insert(newRows).select("*");
      data = res.data ?? [];
      error = res.error;
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await syncCompanyDirectoryFromJobs(data ?? []);
    imported = data.length;
  }

  if (profileLabel) {
    if (isNeon()) {
      try {
        await execute(
          'INSERT INTO import_profiles (label, column_map) VALUES ($1, $2)',
          [profileLabel.trim(), mapping]
        );
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
      }
    } else {
      const { error } = await supabase
        .from("import_profiles")
        .insert({ label: profileLabel.trim(), column_map: mapping });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    imported,
    skipped: table.rows.length - cleaned.length + duplicates,
  });
}
