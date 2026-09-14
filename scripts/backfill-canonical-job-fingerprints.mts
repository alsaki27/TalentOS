// scripts/backfill-canonical-job-fingerprints.mts
//
// Re-computes jobs.apply_link_fingerprint with the canonical platform-job-key
// algorithm (src/lib/jobUrlFingerprint.ts, reworked 2026-09-14).
//
// Why this is REQUIRED, not cosmetic: the duplicate guard matches a new job
// against stored fingerprints. Existing rows hold values from the old
// URL-string algorithm, which no new capture will ever reproduce - so
// without this backfill the improved matching only ever compares new rows
// against other new rows, and re-capturing a job that's already in the table
// would still create a duplicate.
//
// Writes ONLY apply_link_fingerprint. Never edits title/company/location,
// never sets is_active, never deletes or merges a row. Existing duplicate
// rows stay exactly as they are and stay visible - cleaning those up is a
// separate, destructive decision this script deliberately does not make.
//
// Unique-index handling (sql/neon_fixes/095 puts a partial UNIQUE index on
// apply_link_fingerprint for rows created_at >= 2026-09-06): when several
// rows in that window resolve to one canonical key they cannot all hold it.
// The OLDEST row in the group keeps the key - it is the original posting and
// the one checkJobDuplicate already prefers (ORDER BY created_at ASC LIMIT 1)
// - and the newer duplicates are set to NULL, which simply means "does not
// participate in fingerprint matching". That is correct: a future capture of
// that job matches the older canonical row and is blocked, which is the whole
// point. Rows outside the unique window keep their key even when duplicated,
// since only a non-unique index covers them.
//
// Usage:
//   npx tsx scripts/backfill-canonical-job-fingerprints.mts           # dry run, writes nothing
//   npx tsx scripts/backfill-canonical-job-fingerprints.mts --apply   # performs the update

import { Client } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { resolve } from "path";
import { computeApplyLinkFingerprint } from "../src/lib/jobUrlFingerprint";

const UNIQUE_INDEX_FROM = new Date("2026-09-06T00:00:00Z");
const BATCH_SIZE = 500;

let dbUrl = process.env.DATABASE_URL ?? "";
try {
  readFileSync(resolve(process.cwd(), ".env.local"), "utf-8")
    .split("\n")
    .forEach((line) => {
      if (line.startsWith("DATABASE_URL=") && !dbUrl) dbUrl = line.split("=").slice(1).join("=").trim();
    });
} catch {
  /* .env.local absent is fine when DATABASE_URL is already in the environment */
}
if (!dbUrl) {
  console.error("DATABASE_URL not set (checked process.env and .env.local).");
  process.exit(1);
}

const apply = process.argv.includes("--apply");

interface JobRow {
  id: string;
  title: string | null;
  company: string | null;
  apply_url: string | null;
  source_url: string | null;
  apply_link_fingerprint: string | null;
  created_at: string;
}

async function main() {
  const client = new Client(dbUrl);
  await client.connect();

  const { rows } = await client.query<JobRow>(
    `SELECT id, title, company, apply_url, source_url, apply_link_fingerprint, created_at
     FROM jobs ORDER BY created_at ASC, id ASC`
  );
  console.log(`Loaded ${rows.length} job rows.`);

  // Group by the NEW canonical key, oldest first (the query's ORDER BY
  // guarantees the first member of each group is the original posting).
  const byNewKey = new Map<string, JobRow[]>();
  for (const row of rows) {
    const key = computeApplyLinkFingerprint({ applyUrl: row.apply_url, sourceUrl: row.source_url });
    if (!key) continue;
    if (!byNewKey.has(key)) byNewKey.set(key, []);
    byNewKey.get(key)!.push(row);
  }

  const updates: { id: string; value: string | null }[] = [];
  let keptKey = 0;
  let nulledForUniqueIndex = 0;
  let alreadyCorrect = 0;

  for (const [key, group] of byNewKey) {
    let uniqueWindowClaimed = false;
    for (const row of group) {
      const inUniqueWindow = new Date(row.created_at) >= UNIQUE_INDEX_FROM;
      let target: string | null = key;

      if (inUniqueWindow) {
        if (uniqueWindowClaimed) {
          target = null; // a newer duplicate inside the unique window
          nulledForUniqueIndex++;
        } else {
          uniqueWindowClaimed = true;
          keptKey++;
        }
      } else {
        keptKey++;
      }

      if (row.apply_link_fingerprint === target) { alreadyCorrect++; continue; }
      updates.push({ id: row.id, value: target });
    }
  }

  const dupGroups = [...byNewKey.values()].filter((g) => g.length > 1);
  console.log();
  console.log(`Canonical keys: ${byNewKey.size}`);
  console.log(`  groups covering more than one existing row: ${dupGroups.length} (${dupGroups.reduce((s, g) => s + g.length - 1, 0)} redundant rows already in the table)`);
  console.log(`Rows already holding the correct value: ${alreadyCorrect}`);
  console.log(`Rows to update: ${updates.length}`);
  console.log(`  of which set to NULL to respect the partial unique index: ${nulledForUniqueIndex}`);
  console.log();
  console.log("Top existing duplicate groups (NOT removed by this script — reported only):");
  for (const g of dupGroups.sort((a, b) => b.length - a.length).slice(0, 10)) {
    console.log(`  ${g.length} rows  "${g[0].title}" @ ${g[0].company}`);
  }

  if (!apply) {
    console.log();
    console.log("Dry run only — nothing written. Re-run with --apply to perform the update.");
    await client.end();
    return;
  }

  console.log();
  let done = 0;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    // One statement per batch via UNNEST rather than per-row round trips.
    await client.query(
      `UPDATE jobs AS j
       SET apply_link_fingerprint = v.fp
       FROM (SELECT * FROM UNNEST($1::uuid[], $2::text[]) AS t(id, fp)) AS v
       WHERE j.id = v.id`,
      [batch.map((u) => u.id), batch.map((u) => u.value)]
    );
    done += batch.length;
    console.log(`  updated ${done}/${updates.length}`);
  }

  console.log();
  console.log(`Done. ${done} row(s) updated. No rows were deleted, deactivated, or merged.`);
  await client.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
