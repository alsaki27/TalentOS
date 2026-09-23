// One-off backfill: populates jobs.apply_link_fingerprint for every
// existing row (added by migration 094). Only ever writes this one new,
// nullable column - never touches title, company, is_active, or anything
// else, and never deletes or merges any row.
//
// Run with: npx tsx --env-file=.env.local scripts/backfill-job-fingerprints.ts
//
// Paginates by id (keyset pagination) rather than re-querying
// "WHERE apply_link_fingerprint IS NULL" - a job with neither apply_url nor
// source_url genuinely backfills TO null, and a null-filter re-query can
// never tell that apart from "not processed yet", so it would re-select
// (and re-process) that same link-less row forever. Confirmed live: an
// earlier version of this script did exactly that and ran for over an hour
// without terminating before a transient network blip finally killed it.
// Keyset-by-id guarantees each row is visited exactly once, so a re-run
// after an interruption is still safe (just re-verifies already-correct
// rows) without the infinite-loop risk.
//
// After backfilling, prints a duplicate report (fingerprints shared by more
// than one existing job) for manual review - nothing is auto-resolved.

import { query, execute } from "../src/server/db/neon";
import { computeApplyLinkFingerprint } from "../src/lib/jobUrlFingerprint";

const BATCH_SIZE = 500;

async function backfillBatch(afterId: string | null): Promise<{ count: number; lastId: string | null }> {
  const rows = await query<{ id: string; apply_url: string | null; source_url: string | null }>(
    afterId
      ? `SELECT id, apply_url, source_url FROM jobs WHERE id > $1 ORDER BY id LIMIT $2`
      : `SELECT id, apply_url, source_url FROM jobs ORDER BY id LIMIT $1`,
    afterId ? [afterId, BATCH_SIZE] : [BATCH_SIZE]
  );
  if (rows.length === 0) return { count: 0, lastId: afterId };

  for (const row of rows) {
    const fingerprint = computeApplyLinkFingerprint({ applyUrl: row.apply_url, sourceUrl: row.source_url });
    await execute(`UPDATE jobs SET apply_link_fingerprint = $1 WHERE id = $2`, [fingerprint, row.id]);
  }
  return { count: rows.length, lastId: rows[rows.length - 1].id };
}

async function printDuplicateReport(): Promise<void> {
  const groups = await query<{ apply_link_fingerprint: string; n: number; job_ids: string[] }>(
    `SELECT apply_link_fingerprint, COUNT(*)::int as n, array_agg(id) as job_ids
     FROM jobs
     WHERE apply_link_fingerprint IS NOT NULL
     GROUP BY apply_link_fingerprint
     HAVING COUNT(*) > 1
     ORDER BY n DESC`
  );
  console.log(`\n=== Duplicate report: ${groups.length} apply-link fingerprint(s) shared by more than one existing job ===`);
  console.log("(Informational only - nothing here was changed. Review and decide manually whether to deactivate/merge any of these.)\n");
  for (const g of groups) {
    console.log(`  ${g.n} jobs share fingerprint "${g.apply_link_fingerprint}": ${g.job_ids.join(", ")}`);
  }
  if (groups.length === 0) console.log("  None found.");
}

async function main() {
  // Resuming after an interruption: pass the last successfully-processed id
  // as argv[2] to skip straight past everything already visited, e.g.
  //   npx tsx --env-file=.env.local scripts/backfill-job-fingerprints.ts <last-id>
  const resumeAfterId = process.argv[2] || null;
  console.log("Backfilling jobs.apply_link_fingerprint in batches of", BATCH_SIZE, resumeAfterId ? `(resuming after ${resumeAfterId})` : "...");

  let total = 0;
  let cursor: string | null = resumeAfterId;
  while (true) {
    const { count, lastId } = await backfillBatch(cursor);
    if (count === 0) break;
    total += count;
    cursor = lastId;
    console.log(`  ...processed ${total} rows so far (last id: ${cursor})`);
  }
  console.log(`Done. ${total} rows visited this run.`);

  await printDuplicateReport();
}

main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e); process.exit(1); });
