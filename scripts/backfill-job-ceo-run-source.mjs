// scripts/backfill-job-ceo-run-source.mjs
//
// One-time correction for job_ceo_runs.source rows mislabeled "openjobdata"
// by the bug fixed in src/app/api/job-ceo/ingest/route.ts (that route
// hardcoded source: "openjobdata" on every run it created, regardless of
// which script actually POSTed the batch).
//
// Scope is deliberately narrow and derived from real data, not a hardcoded
// run-id list: a run is only touched when its CURRENT source is exactly
// "openjobdata" AND every job staged under it (job_ceo_staging.raw->>'source')
// shares one single, different, non-null value. That value becomes the
// run's corrected source.
//
// This intentionally does NOT touch the other kind of mismatch present in
// the same table (runs whose source is "apify_bridge" while their staged
// jobs carry raw.source "apify_job_agent") — that is a separate, pre-existing
// run-mechanism-vs-job-origin distinction this investigation was never asked
// about and has no evidence of being wrong; scoping to source = 'openjobdata'
// excludes it naturally, not via a special-cased skip.
//
// A run with zero staged jobs, or with staged jobs disagreeing on source,
// cannot be corrected here (nothing to derive the truth from / ambiguous)
// and is reported, not silently skipped.
//
// Usage:
//   node scripts/backfill-job-ceo-run-source.mjs            # dry run (default) — prints the plan, writes nothing
//   node scripts/backfill-job-ceo-run-source.mjs --apply    # performs the UPDATE

import { Client } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.local");
let dbUrl = process.env.DATABASE_URL ?? "";
try {
  const envFile = readFileSync(envPath, "utf-8");
  envFile.split("\n").forEach((line) => {
    if (line.startsWith("DATABASE_URL=") && !dbUrl) {
      dbUrl = line.split("=").slice(1).join("=").trim();
    }
  });
} catch {
  // .env.local absent is fine if DATABASE_URL is already set in the environment.
}
if (!dbUrl) {
  console.error("DATABASE_URL not set (checked process.env and .env.local).");
  process.exit(1);
}

const apply = process.argv.includes("--apply");

async function main() {
  const client = new Client(dbUrl);
  await client.connect();

  // Every candidate run currently labeled "openjobdata", with the set of
  // distinct non-null raw.source values its own staged jobs actually carry.
  const { rows } = await client.query(`
    SELECT r.id, r.source AS current_source, r.created_at,
           array_agg(DISTINCT (s.raw->>'source')) FILTER (WHERE s.raw->>'source' IS NOT NULL) AS staged_sources,
           count(s.id) AS staged_row_count
    FROM job_ceo_runs r
    LEFT JOIN job_ceo_staging s ON s.run_id = r.id
    WHERE r.source = 'openjobdata'
    GROUP BY r.id, r.source, r.created_at
  `);

  const toCorrect = [];
  const noStagedRows = [];
  const ambiguous = [];

  for (const row of rows) {
    const sources = row.staged_sources || [];
    if (Number(row.staged_row_count) === 0 || sources.length === 0) {
      noStagedRows.push(row.id);
      continue;
    }
    if (sources.length > 1) {
      ambiguous.push({ id: row.id, sources });
      continue;
    }
    const trueSource = sources[0];
    if (trueSource !== "openjobdata") {
      toCorrect.push({ id: row.id, from: row.current_source, to: trueSource, createdAt: row.created_at });
    }
  }

  console.log(`Scanned ${rows.length} run(s) currently labeled "openjobdata".`);
  console.log(`  To correct:        ${toCorrect.length}`);
  console.log(`  No staged rows:    ${noStagedRows.length} (cannot derive truth — left untouched)`);
  console.log(`  Ambiguous/mixed:   ${ambiguous.length} (multiple distinct sources under one run — left untouched, needs manual review)`);
  console.log();

  if (toCorrect.length > 0) {
    console.log("=== Runs to correct ===");
    for (const c of toCorrect) {
      console.log(`  ${c.id}  ${c.from} -> ${c.to}  (created ${c.createdAt.toISOString?.() ?? c.createdAt})`);
    }
    console.log();
  }
  if (ambiguous.length > 0) {
    console.log("=== Ambiguous — needs manual review, not touched ===");
    for (const a of ambiguous) console.log(`  ${a.id}  staged sources: ${a.sources.join(", ")}`);
    console.log();
  }

  if (!apply) {
    console.log(toCorrect.length > 0
      ? "Dry run only — no rows changed. Re-run with --apply to write these corrections."
      : "Dry run only — nothing to correct.");
    await client.end();
    return;
  }

  if (toCorrect.length === 0) {
    console.log("Nothing to apply.");
    await client.end();
    return;
  }

  let updated = 0;
  for (const c of toCorrect) {
    const result = await client.query(
      `UPDATE job_ceo_runs SET source = $1 WHERE id = $2 AND source = 'openjobdata'`,
      [c.to, c.id]
    );
    updated += result.rowCount ?? 0;
  }
  console.log(`Applied: ${updated} run(s) corrected.`);
  await client.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
