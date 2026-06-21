// src/app/api/import/normalize/commit/route.ts
// Minimal commit: URL-based dedupe only, 2 DB queries per batch max.
// NO syncCompanyDirectoryFromJobs, NO fuzzy dedupe, NO enrich loop.

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";
import { detectFormat } from "@/lib/normalizer/detect";
import { parseTable } from "@/lib/normalizer/parse";
import { applyMapping, FieldMapping } from "@/lib/normalizer";

const BATCH_SIZE = 50;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function findExistingUrls(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  if (isNeon()) {
    const rows = await query<{ source_url: string }>(
      "SELECT source_url FROM jobs WHERE source_url = ANY($1)",
      [urls]
    );
    return new Set((rows ?? []).map((r) => r.source_url));
  }
  const { data, error } = await supabase
    .from("jobs")
    .select("source_url")
    .in("source_url", urls);
  if (error) throw error;
  return new Set((data ?? []).map((r: any) => r.source_url));
}

export async function POST(req: NextRequest) {
  try {
    const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
    if (response) return response;

    const body = await req.json();
    const rows = body.rows as any[] | undefined;
    const filename = body.filename as string | undefined;
    const content = body.content as string | undefined;
    const mapping = body.mapping as FieldMapping | undefined;
    const sourceLabel = body.sourceLabel as string | undefined;

    let rowsToInsert: any[];
    let totalRowCount: number;

    if (rows && Array.isArray(rows) && rows.length > 0) {
      rowsToInsert = rows.map((row) => ({
        ...row,
        source: sourceLabel?.trim() || "normalized_import",
        category_status: "pending",
      }));
      totalRowCount = rows.length;
    } else if (filename && content && mapping) {
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
      rowsToInsert = cleaned.map((row) => ({
        ...row,
        source: sourceLabel?.trim() || "normalized_import",
        category_status: "pending",
      }));
      totalRowCount = table.rows.length;
    } else {
      return NextResponse.json({ error: "rows array or (filename + content + mapping) is required" }, { status: 400 });
    }

    // Process in batches — only 2 DB calls per batch (find URLs + insert)
    const batches = chunkArray(rowsToInsert, BATCH_SIZE);
    let totalImported = 0;
    let totalSkipped = 0;

    for (const batch of batches) {
      const validRows = batch.filter((r) => r.title && r.title.trim());
      totalSkipped += batch.length - validRows.length;
      if (validRows.length === 0) continue;

      const urls = validRows.map((r) => r.source_url).filter((u): u is string => !!u);
      const existingUrls = await findExistingUrls(urls);

      const newRows = validRows.filter((r) => {
        if (!r.source_url) return true; // no URL → assume new (rare for LinkedIn)
        return !existingUrls.has(r.source_url);
      });

      totalSkipped += validRows.length - newRows.length;

      if (newRows.length === 0) continue;

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

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      totalImported += data.length;
    }

    return NextResponse.json({
      imported: totalImported,
      skipped: totalSkipped,
    });
  } catch (err: any) {
    console.error("Import commit error:", err);
    return NextResponse.json(
      { error: err.message || "Import failed due to server error." },
      { status: 500 }
    );
  }
}
