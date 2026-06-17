// src/lib/normalizer/index.ts
// Two-phase pipeline: analyzeFile (detect+parse+heuristic map, for the UI to preview/adjust)
// then applyMapping (clean + produce final rows once the mapping is confirmed).

import { detectFormat } from "./detect";
import { parseTable } from "./parse";
import { heuristicFieldMapper } from "./fieldMap";
import { cleanRow, CleanedJobRow } from "./clean";
import { FieldMapping, SchemaField } from "./types";

export interface AnalyzeResult {
  headersDetected: boolean;
  mapping: FieldMapping;
  unmappedHeaders: string[];
  confident: boolean;
  rawHeaders: string[];
  sampleRows: Record<string, string>[];
  rows: Record<string, string>[];
}

export function analyzeFile(filename: string, content: string): AnalyzeResult {
  const format = detectFormat(filename, content);
  const table = parseTable(format, content);
  const { mapping, unmappedHeaders, confident } = heuristicFieldMapper.mapFields(
    table.headers,
    table.rows.slice(0, 5)
  );

  return {
    headersDetected: table.headersDetected,
    mapping,
    unmappedHeaders,
    confident: confident && table.headersDetected,
    rawHeaders: table.headers,
    sampleRows: table.rows.slice(0, 5),
    rows: table.rows,
  };
}

export function applyMapping(rows: Record<string, string>[], mapping: FieldMapping): CleanedJobRow[] {
  const cleaned: CleanedJobRow[] = [];
  for (const row of rows) {
    const mapped: Record<string, string | undefined> = {};
    for (const field of Object.keys(mapping) as SchemaField[]) {
      const header = mapping[field];
      if (header) mapped[field] = row[header];
    }
    const c = cleanRow(mapped);
    if (c) cleaned.push({ ...c, raw_source_payload: row });
  }
  return cleaned;
}

export type { SchemaField, FieldMapping } from "./types";
export type { CleanedJobRow } from "./clean";
