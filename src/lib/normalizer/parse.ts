// src/lib/normalizer/parse.ts
// Parses csv/tsv/json into a uniform { headers, rows, headersDetected } shape.
// Headerless delimited files get synthesized positional headers (col_0, col_1, ...)
// rather than guessing real column names.

import Papa from "papaparse";
import { DetectedFormat } from "./detect";
import { ParsedTable } from "./types";

const HEADER_LABELS = new Set(
  [
    "title", "job title", "position", "role", "job_title", "posting title",
    "company", "employer", "company name", "organization", "companyname",
    "location", "city", "job location", "joblocation",
    "url", "link", "job url", "posting url", "source_url", "apply url",
    "posted", "date posted", "posted_at", "publish date", "postedat",
    "salary", "salary range", "comp", "compensation",
    "tier", "role tier", "category",
    "notes", "comment", "comments", "description",
  ].map(normalizeHeaderLabel)
);

function normalizeHeaderLabel(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function looksLikeDataCell(cell: string): boolean {
  const t = cell.trim();
  if (!t) return false;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^\d+([.,]\d+)?$/.test(t)) return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t)) return true;
  if (/@/.test(t)) return true;
  return false;
}

// A row "looks like a header" when most cells are short, label-like strings rather
// than data-shaped values (URLs, dates, emails, bare numbers).
function rowLooksLikeHeader(row: string[]): boolean {
  if (row.length === 0) return false;
  const dataLike = row.filter(looksLikeDataCell).length;
  const labelLike = row.filter((cell) => HEADER_LABELS.has(normalizeHeaderLabel(cell))).length;
  return dataLike / row.length < 0.5 && labelLike > 0;
}

export function parseDelimited(content: string, delimiter?: "," | "\t"): ParsedTable {
  const result = Papa.parse<string[]>(content.trim(), { delimiter, skipEmptyLines: true });
  const rows = (result.data as string[][]).filter((r) => r.length > 0);
  if (rows.length === 0) return { headers: [], rows: [], headersDetected: false };

  const headersDetected = rowLooksLikeHeader(rows[0]);
  const headers = headersDetected ? rows[0] : rows[0].map((_, i) => `col_${i}`);
  const dataRows = headersDetected ? rows.slice(1) : rows;

  const objRows = dataRows.map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = r[i] ?? ""; });
    return obj;
  });

  return { headers, rows: objRows, headersDetected };
}

export function parseJson(content: string): ParsedTable {
  const data = JSON.parse(content);
  const arr = Array.isArray(data) ? data : [data];
  const headerSet = new Set<string>();
  arr.forEach((row) => Object.keys(row ?? {}).forEach((k) => headerSet.add(k)));
  const headers = Array.from(headerSet);

  const rows = arr.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h) => {
      const v = row?.[h];
      obj[h] = v === null || v === undefined
        ? ""
        : typeof v === "object"
          ? JSON.stringify(v)
          : String(v);
    });
    return obj;
  });

  // JSON keys are unambiguous field labels — there's no "headerless JSON" case.
  return { headers, rows, headersDetected: true };
}

export function parseTable(format: DetectedFormat, content: string): ParsedTable {
  switch (format) {
    case "csv": return parseDelimited(content);
    case "tsv": return parseDelimited(content, "\t");
    case "json": return parseJson(content);
  }
}
