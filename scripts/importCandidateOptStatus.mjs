// One-time, idempotent import for the candidate OPT/work-authorization tracker.
// Candidate Name is used only for an exact normalized match to candidates.name;
// it is never inserted into candidate_opt_status.
//
// Usage:
//   node scripts/importCandidateOptStatus.mjs --csv "C:\\path\\Candidate OPT Status.csv"
//   node scripts/importCandidateOptStatus.mjs --csv "C:\\path\\Candidate OPT Status.csv" --apply
//   node scripts/importCandidateOptStatus.mjs --csv "C:\\path\\Candidate OPT Status.csv" --validate-only
//
// Dry-run is the default. Apply only after the candidate_opt_status migration
// has been deployed and the dry-run confirms that every source row maps once.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Papa from "papaparse";
import { getDbClient } from "./lib/db.mjs";

const FIELDS = [
  { label: "EAD / Work Authorization Type", column: "ead_work_authorization_type", kind: "text" },
  { label: "Application Filed Date", column: "application_filed_date", monthYearColumn: "application_filed_month_year", notProvidedColumn: "application_filed_not_provided", kind: "date" },
  { label: "Receipt Notice Date", column: "receipt_notice_date", monthYearColumn: "receipt_notice_month_year", notProvidedColumn: "receipt_notice_not_provided", kind: "date" },
  { label: "Biometrics Date", column: "biometrics_date", monthYearColumn: "biometrics_month_year", notProvidedColumn: "biometrics_not_provided", kind: "date" },
  { label: "Processing Type", column: "processing_type", kind: "text" },
  { label: "Premium Processing Status", column: "premium_processing_status", kind: "text" },
  { label: "Premium Trigger / Plan", column: "premium_trigger_plan", kind: "text" },
  { label: "USCIS Current Status", column: "uscis_current_status", kind: "text" },
  { label: "Approval Date", column: "approval_date", monthYearColumn: "approval_month_year", notProvidedColumn: "approval_not_provided", kind: "date" },
  { label: "Card Produced Date", column: "card_produced_date", monthYearColumn: "card_produced_month_year", notProvidedColumn: "card_produced_not_provided", kind: "date" },
  { label: "Card Mailed Date", column: "card_mailed_date", monthYearColumn: "card_mailed_month_year", notProvidedColumn: "card_mailed_not_provided", kind: "date" },
  { label: "EAD Card Received Date", column: "ead_card_received_date", monthYearColumn: "ead_card_received_month_year", notProvidedColumn: "ead_card_received_not_provided", kind: "date" },
  { label: "Expected Start / Work-Eligible Date", column: "expected_start_work_eligible_date", kind: "text" },
  { label: "Ready for Full Application Volume?", column: "ready_for_full_application_volume", kind: "text" },
  { label: "Days Pending", column: "days_pending", kind: "text" },
  { label: "Notes", column: "notes", kind: "text" },
];
const HEADERS = ["Candidate Name", ...FIELDS.map(({ label }) => label)];
const MONTHS = new Map(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map((month, index) => [month, index + 1]));

function parseArgs(args) {
  let csvPath = null;
  let apply = false;
  let validateOnly = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--csv") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("--csv requires a file path.");
      csvPath = value;
    }
    else if (args[i] === "--apply") apply = true;
    else if (args[i] === "--validate-only") validateOnly = true;
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (!csvPath) throw new Error('Pass the source file with --csv "path-to-file.csv".');
  if (apply && validateOnly) throw new Error("--validate-only cannot be combined with --apply.");
  return { csvPath: resolve(csvPath), apply, validateOnly };
}

function normalizeName(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function validIsoDate(year, month, day) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function expandYear(value) {
  const year = Number(value);
  if (value.length === 4) return year;
  return year <= 69 ? 2000 + year : 1900 + year;
}

function parseSourceDate(value, rowNumber, label) {
  const raw = String(value ?? "").trim();
  if (!raw) return { date: null, monthYear: null, notProvided: false };
  // This tracker uses a standalone replacement glyph as its missing-date
  // marker. Convert only that exact cell value; embedded replacement glyphs
  // remain errors because they may hide a damaged date.
  if (raw === "\uFFFD" || raw.toLocaleLowerCase("en-US") === "not provided") {
    return { date: null, monthYear: null, notProvided: true };
  }
  const receivedWithoutDate = raw.match(/^(.+?);\s*exact date not provided$/i);
  if (receivedWithoutDate) {
    return { date: null, monthYear: null, notProvided: true, detail: raw };
  }

  const fullDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (fullDate) {
    const [, yearText, monthText, dayText] = fullDate;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (year >= 1 && validIsoDate(year, month, day)) return { date: raw, monthYear: null, notProvided: false };
  }

  const dayMonthName = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if (dayMonthName) {
    const day = Number(dayMonthName[1]);
    const month = MONTHS.get(dayMonthName[2].toLocaleLowerCase("en-US"));
    const year = expandYear(dayMonthName[3]);
    if (month && year >= 1 && validIsoDate(year, month, day)) {
      return { date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, monthYear: null, notProvided: false };
    }
  }

  const monthName = raw.match(/^([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if (monthName) {
    const month = MONTHS.get(monthName[1].toLocaleLowerCase("en-US"));
    const year = expandYear(monthName[2]);
    if (month && year >= 1) {
      return { date: null, monthYear: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`, notProvided: false };
    }
  }

  throw new Error(`CSV row ${rowNumber}, “${label}” is not a supported date, month/year, or “Not Provided” value; review it before importing.`);
}

function parseCsv(path) {
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: "greedy", transformHeader: (header) => header.trim() });
  if (parsed.errors.length) {
    throw new Error(`CSV parsing failed on ${parsed.errors.length} row(s); correct the file and retry.`);
  }

  const actualHeaders = parsed.meta.fields ?? [];
  if (actualHeaders.length !== HEADERS.length || HEADERS.some((header, index) => actualHeaders[index] !== header)) {
    throw new Error("CSV headers do not match the expected Candidate OPT Status template.");
  }

  const rows = parsed.data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""));
  const validationErrors = [];
  const preparedRows = rows.map((row, index) => {
    const databaseEntries = [];
    const dateDetails = [];
    for (const field of FIELDS) {
      const value = String(row[field.label] ?? "");
      if (field.kind === "text") {
        databaseEntries.push({ column: field.column, value: value.trim() === "" ? null : value });
        continue;
      }
      try {
        const parsedDate = parseSourceDate(value, index + 2, field.label);
        databaseEntries.push({ column: field.column, value: parsedDate.date });
        databaseEntries.push({ column: field.monthYearColumn, value: parsedDate.monthYear });
        databaseEntries.push({ column: field.notProvidedColumn, value: parsedDate.notProvided });
        if (parsedDate.detail) dateDetails.push(`${field.label}: ${parsedDate.detail}`);
      } catch (error) {
        validationErrors.push(error.message);
      }
    }
    if (dateDetails.length) {
      const notes = databaseEntries.find(({ column }) => column === "notes");
      if (notes) {
        const sourceDetails = dateDetails.map((detail) => `Source date detail — ${detail}`).join("\n");
        notes.value = notes.value ? `${notes.value}\n${sourceDetails}` : sourceDetails;
      }
    }
    return { row, databaseEntries };
  });
  if (validationErrors.length) {
    const details = validationErrors.slice(0, 20).join("\n");
    const omitted = validationErrors.length > 20 ? `\n…and ${validationErrors.length - 20} more invalid date cell(s).` : "";
    throw new Error(`The CSV has ${validationErrors.length} date cell(s) that need review. No rows were imported.\n${details}${omitted}`);
  }
  return preparedRows;
}

async function main() {
  const { csvPath, apply, validateOnly } = parseArgs(process.argv.slice(2));
  const sourceRows = parseCsv(csvPath);
  if (!sourceRows.length) throw new Error("The CSV contains no candidate rows.");

  if (validateOnly) {
    const dateCounts = { fullDate: 0, monthYear: 0, notProvided: 0, blank: 0 };
    for (const sourceRecord of sourceRows) {
      for (const field of FIELDS.filter(({ kind }) => kind === "date")) {
        const values = new Map(sourceRecord.databaseEntries.map(({ column, value }) => [column, value]));
        if (values.get(field.column)) dateCounts.fullDate += 1;
        else if (values.get(field.monthYearColumn)) dateCounts.monthYear += 1;
        else if (values.get(field.notProvidedColumn)) dateCounts.notProvided += 1;
        else dateCounts.blank += 1;
      }
    }
    console.log(`CSV validation passed: ${sourceRows.length} row(s), ${dateCounts.fullDate} full date(s), ${dateCounts.monthYear} month/year value(s), ${dateCounts.notProvided} “Not Provided” value(s), ${dateCounts.blank} blank date cell(s).`);
    console.log("No database connection was opened and no rows were changed.");
    return;
  }

  const db = await getDbClient();
  try {
    const table = await db.query("SELECT to_regclass('public.candidate_opt_status') AS table_name");
    if (!table.rows[0]?.table_name) {
      throw new Error("candidate_opt_status does not exist. Apply its Supabase migration before importing.");
    }

    const { rows: candidates } = await db.query("SELECT id, name FROM candidates");
    const byName = new Map();
    for (const candidate of candidates) {
      const normalized = normalizeName(candidate.name);
      if (!normalized) continue;
      const matches = byName.get(normalized) ?? [];
      matches.push(candidate);
      byName.set(normalized, matches);
    }

    const seenNames = new Set();
    const prepared = [];
    let unmatched = 0;
    let ambiguous = 0;
    let duplicateSource = 0;
    for (const sourceRecord of sourceRows) {
      const { row } = sourceRecord;
      const normalized = normalizeName(row["Candidate Name"]);
      if (!normalized) {
        unmatched += 1;
        continue;
      }
      if (seenNames.has(normalized)) {
        duplicateSource += 1;
        continue;
      }
      seenNames.add(normalized);

      const matches = byName.get(normalized) ?? [];
      if (matches.length === 0) {
        unmatched += 1;
        continue;
      }
      if (matches.length > 1) {
        ambiguous += 1;
        continue;
      }

      const data = sourceRecord.databaseEntries;
      prepared.push({ candidateId: matches[0].id, data });
    }

    if (unmatched || ambiguous || duplicateSource) {
      console.log(`Source rows: ${sourceRows.length}; matched uniquely: ${prepared.length}; unmatched: ${unmatched}; ambiguous candidate matches: ${ambiguous}; duplicate source names: ${duplicateSource}.`);
      throw new Error("No rows were imported. Resolve all unmatched, ambiguous, and duplicate names before retrying.");
    }

    const candidateIds = prepared.map(({ candidateId }) => candidateId);
    const { rows: existing } = await db.query(
      "SELECT candidate_id FROM candidate_opt_status WHERE candidate_id = ANY($1::uuid[])",
      [candidateIds],
    );
    const existingIds = new Set(existing.map(({ candidate_id }) => candidate_id));
    const toInsert = prepared.filter(({ candidateId }) => !existingIds.has(candidateId));

    console.log(`Source rows: ${sourceRows.length}; matched uniquely: ${prepared.length}; already present and left unchanged: ${existing.length}; ready to insert: ${toInsert.length}.`);
    if (!apply) {
      console.log("Dry run only; no database rows were changed. Add --apply after reviewing these counts.");
      return;
    }

    await db.query("BEGIN");
    try {
      let inserted = 0;
      for (const { candidateId, data } of toInsert) {
        const insertColumns = ["candidate_id", ...data.map(({ column }) => column)];
        const placeholders = insertColumns.map((_, index) => `$${index + 1}`);
        const statement = `INSERT INTO candidate_opt_status (${insertColumns.join(", ")}) VALUES (${placeholders.join(", ")}) ON CONFLICT (candidate_id) DO NOTHING`;
        const result = await db.query(statement, [candidateId, ...data.map(({ value }) => value)]);
        inserted += result.rowCount ?? 0;
      }
      await db.query("COMMIT");
      console.log(`Imported ${inserted} row(s); concurrent/existing rows were left unchanged.`);
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(`OPT status import failed: ${error?.message ?? String(error)}`);
  process.exitCode = 1;
});
