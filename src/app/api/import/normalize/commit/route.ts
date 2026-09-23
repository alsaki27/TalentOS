// src/app/api/import/normalize/commit/route.ts
// Minimal commit: apply-link-fingerprint dedupe (via createJobs), no fuzzy
// dedupe, no enrich loop - unchanged design intent, just a real URL check
// (normalized, checks apply_url too) instead of a raw source_url exact match.

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { detectFormat } from "@/lib/normalizer/detect";
import { parseTable } from "@/lib/normalizer/parse";
import { applyMapping, FieldMapping } from "@/lib/normalizer";
import { createJobs, type JobRow } from "@/server/repositories/jobsRepository";
import { notifyBatchDuplicateSummary } from "@/lib/jobDuplicateNotify";

const BATCH_SIZE = 50;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
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

    const batches = chunkArray(rowsToInsert, BATCH_SIZE);
    let totalImported = 0;
    let totalSkipped = 0;
    const allDuplicates: { input: Record<string, any>; existing: JobRow & { id: string; title: string; company: string | null; created_at: string | null }; fingerprint: string }[] = [];

    for (const batch of batches) {
      const validRows = batch.filter((r) => r.title && r.title.trim());
      totalSkipped += batch.length - validRows.length;
      if (validRows.length === 0) continue;

      const { inserted, duplicates } = await createJobs(validRows);
      totalImported += inserted.length;
      totalSkipped += duplicates.length;
      allDuplicates.push(...(duplicates as any));
    }

    if (allDuplicates.length > 0) {
      await notifyBatchDuplicateSummary({
        runLabel: `file import (${filename ?? sourceLabel ?? "normalized rows"})`,
        runLink: "/jobs",
        totalCandidates: totalRowCount,
        duplicates: allDuplicates.map((d) => ({
          attemptedTitle: d.input.title, attemptedCompany: d.input.company ?? null,
          attemptedApplyUrl: d.input.apply_url ?? d.input.source_url ?? null, existing: d.existing,
        })),
      }).catch((err) => console.error("Import commit duplicate summary failed:", err));
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
