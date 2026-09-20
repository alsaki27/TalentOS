// scripts/backfill-job-content-duplicates.mts
//
// Two things, both required for the cross-platform content-duplicate guard
// (src/server/services/jobContentDuplicateGuard.ts, migration
// sql/neon_fixes/099) to actually work against jobs captured BEFORE it
// shipped, not just new-vs-new captures going forward:
//
//   1. Populate content_identity_key on every existing row. Safe and
//      additive - it's only a lookup key, changes nothing else. Without
//      this, a job captured via LinkedIn last month would never be found
//      when the same job is captured via Indeed today, because the
//      LinkedIn row's key would be NULL forever.
//   2. Retroactively mark already-confirmed historical duplicate PAIRS
//      is_active = false (content_duplicate_of pointing at the original).
//      This is a real, visible change to jobs already published - unlike
//      step 1, this is NOT auto-applied by --apply; it requires the
//      separate --dedupe flag, so it's a deliberate choice, not a side
//      effect of turning the feature on.
//
// Uses the exact same precision rule as the live guard (see
// jobContentDuplicateGuard.ts): only acts on a company+title group whose
// FINAL size is exactly 2 distinct real postings (by apply_link_fingerprint)
// with compatible locations. A group of 3+ (Amazon, ABB - see
// jobContentIdentity.ts) is left completely untouched, on every row, always.
//
// Scoped to jobs created in the last CONTENT_DUPLICATE_CHECK_WINDOW_DAYS
// (imported from the guard itself, not re-hardcoded) - not just a smaller
// blast radius, but the ONLY correct scope: the live guard's own lookup
// query filters candidates to that same rolling window, so a row older than
// it can never be matched by a future capture regardless of whether its
// content_identity_key is populated. Backfilling further back would write
// data nothing will ever read.
//
// Usage:
//   npx tsx scripts/backfill-job-content-duplicates.mts                    # dry run, writes nothing
//   npx tsx scripts/backfill-job-content-duplicates.mts --apply            # content_identity_key + queue pairs for review
//   npx tsx scripts/backfill-job-content-duplicates.mts --apply --dedupe   # also hides the confirmed duplicate pairs
//   npx tsx scripts/backfill-job-content-duplicates.mts --undo             # dry run of the reversal
//   npx tsx scripts/backfill-job-content-duplicates.mts --undo --apply     # un-hides everything this script ever hid

import { Client } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { resolve } from "path";
import { computeContentIdentityKey, computeTitleLocationKey } from "../src/lib/jobContentIdentity";
import { extractPlatformNamespace } from "../src/lib/jobUrlFingerprint";
import {
  CONTENT_DUPLICATE_CHECK_WINDOW_DAYS,
  CONTENT_IDENTITY_MATCH_SCORE,
} from "../src/server/services/jobContentDuplicateGuard";

let dbUrl = process.env.DATABASE_URL ?? "";
try {
  readFileSync(resolve(process.cwd(), ".env.local"), "utf-8")
    .split("\n")
    .forEach((line) => {
      if (line.startsWith("DATABASE_URL=") && !dbUrl) dbUrl = line.split("=").slice(1).join("=").trim();
    });
} catch {}
if (!dbUrl) {
  console.error("DATABASE_URL not set (checked process.env and .env.local).");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const dedupe = process.argv.includes("--dedupe");
const undo = process.argv.includes("--undo");
const BATCH_SIZE = 500;

interface JobRow {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  apply_url: string | null;
  source_url: string | null;
  apply_link_fingerprint: string | null;
  content_identity_key: string | null;
  title_location_key: string | null;
  source: string | null;
  created_at: string;
}

function describeReason(existing: { id: string; source: string | null; created_at: string }): string {
  const seen = new Date(existing.created_at).toISOString().slice(0, 10);
  return `Auto-hidden: same company+title as job ${existing.id}${existing.source ? ` (source: ${existing.source})` : ""}, first captured ${seen}. Review and re-activate if this is actually a distinct opening.`;
}

async function main() {
  const client = new Client(dbUrl);
  await client.connect();

  const colCheck = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'title_location_key'`
  );
  const hasColumn = colCheck.rows.length > 0;
  if (!hasColumn) {
    console.log("NOTE: migrations 099/101 (content_identity_key, title_location_key) have not run against this database yet.");
    console.log("This dry run still works (it computes everything in memory) but --apply cannot run until that migration deploys.\n");
  }

  // --undo reverses every hide this system has made, using content_duplicate_of
  // as the record of what it touched. It leaves the identity columns alone
  // (harmless lookup keys) and DELETES the review-queue rows rather than
  // marking them resolved.
  //
  // Deleting is deliberate: job_duplicates holds nothing but this detector's
  // own findings, regenerable at any time by re-running detection. Marking them
  // resolved instead was actively wrong - `resolved` means "a human dealt with
  // this", and the re-detect insert is ON CONFLICT DO NOTHING, so a withdrawn
  // finding stayed in the table as resolved and could never be re-raised even
  // when it was still true.
  if (undo) {
    if (!hasColumn) {
      console.error("Nothing to undo: migration 099 has not run, so no hide could have been recorded.");
      await client.end();
      process.exit(1);
    }
    const target = await client.query<{ c: string }>(
      `SELECT COUNT(*) c FROM jobs WHERE content_duplicate_of IS NOT NULL`
    );
    console.log(`--undo: ${target.rows[0].c} row(s) currently carry a content_duplicate_of marker.`);
    if (!apply) {
      console.log("Dry run — nothing written. Re-run with --undo --apply to actually restore them.");
      await client.end();
      return;
    }
    const restored = await client.query(
      `UPDATE jobs SET is_active = true, content_duplicate_of = NULL, content_duplicate_reason = NULL
       WHERE content_duplicate_of IS NOT NULL RETURNING id`
    );
    const dropped = await client.query(`DELETE FROM job_duplicates RETURNING id`);
    console.log(`Restored ${restored.rowCount} row(s) to is_active = true and cleared ${dropped.rowCount} review-queue row(s).`);
    await client.end();
    return;
  }

  const { rows } = await client.query<JobRow>(
    `SELECT id, title, company, location, apply_url, source_url, apply_link_fingerprint,
            ${hasColumn ? "content_identity_key, title_location_key" : "NULL AS content_identity_key, NULL AS title_location_key"}, source, created_at
     FROM jobs
     WHERE apply_link_fingerprint IS NOT NULL
       AND created_at >= NOW() - make_interval(days => $1)
     ORDER BY created_at ASC, id ASC`,
    [CONTENT_DUPLICATE_CHECK_WINDOW_DAYS]
  );
  console.log(`Loaded ${rows.length} fingerprinted job rows from the last ${CONTENT_DUPLICATE_CHECK_WINDOW_DAYS} days (the same rolling window the live guard itself queries against - a row older than this can never be matched by a future capture either way).`);

  if (apply && !hasColumn) {
    console.error("Refusing to --apply: migration 101 has not run yet, so title_location_key does not exist. Deploy the migrations first.");
    await client.end();
    process.exit(1);
  }

  // Both identity columns are recomputed. content_identity_key is null for a
  // row whose company is unusable (the scraping site's own name) - such a row
  // is found through title_location_key instead, which is why both are stamped.
  const keyUpdates: { id: string; key: string | null; tlKey: string | null }[] = [];
  const byKey = new Map<string, JobRow[]>();
  for (const row of rows) {
    const url = row.apply_url ?? row.source_url ?? null;
    const key = computeContentIdentityKey({ title: row.title, company: row.company, location: row.location, url });
    const tlKey = computeTitleLocationKey({ title: row.title, location: row.location });
    if (row.content_identity_key !== key || row.title_location_key !== tlKey) {
      keyUpdates.push({ id: row.id, key, tlKey });
    }
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(row);
  }

  console.log(`\nidentity columns: ${keyUpdates.length} row(s) need updating out of ${rows.length}.`);

  // Distinct-posting groups (by fingerprint, oldest first - the query's
  // ORDER BY guarantees this) whose FINAL size is exactly 2.
  const pairGroups = [...byKey.entries()]
    .map(([key, group]) => {
      const distinctByFingerprint = new Map<string, JobRow>();
      for (const r of group) if (!distinctByFingerprint.has(r.apply_link_fingerprint!)) distinctByFingerprint.set(r.apply_link_fingerprint!, r);
      return { key, distinct: [...distinctByFingerprint.values()] };
    })
    .filter((g) => g.distinct.length === 2);

  const dedupeUpdates: { id: string; existing: JobRow }[] = [];
  const skippedSamePlatform: { a: JobRow; b: JobRow }[] = [];
  for (const g of pairGroups) {
    const [original, newer] = g.distinct; // already oldest-first
    // Mirrors the live guard's RULE 2: two different ids on ONE platform is
    // that platform asserting the postings are different. Never override it.
    const nsA = extractPlatformNamespace(original.apply_link_fingerprint);
    const nsB = extractPlatformNamespace(newer.apply_link_fingerprint);
    if (nsA && nsB && nsA === nsB) {
      skippedSamePlatform.push({ a: original, b: newer });
      continue;
    }
    dedupeUpdates.push({ id: newer.id, existing: original });
  }

  const templaterGroupSizes = [...byKey.entries()]
    .map(([key, group]) => {
      const distinctCount = new Set(group.map((r) => r.apply_link_fingerprint)).size;
      return { key, distinctCount, sample: group[0] };
    })
    .filter((g) => g.distinctCount >= 3)
    .sort((a, b) => b.distinctCount - a.distinctCount);

  console.log(`\nConfirmed cross-platform duplicate PAIRS (identical company+title+location, exactly 2 distinct postings, on different platforms): ${dedupeUpdates.length}`);
  for (const u of dedupeUpdates.slice(0, 15)) {
    console.log(`  "${u.existing.title}" @ ${u.existing.company} — job ${u.id} would be hidden as a duplicate of ${u.existing.id}`);
  }
  if (dedupeUpdates.length > 15) console.log(`  ... and ${dedupeUpdates.length - 15} more`);

  console.log(`\nSkipped - both sides on the SAME platform, so that platform says they are different postings: ${skippedSamePlatform.length}`);
  for (const sp of skippedSamePlatform.slice(0, 5)) {
    console.log(`  "${sp.a.title}" @ ${sp.a.company}: ${sp.a.apply_link_fingerprint} vs ${sp.b.apply_link_fingerprint}`);
  }

  console.log(`\nGroups left untouched on purpose (3+ distinct real postings under one company+title+location): ${templaterGroupSizes.length}`);
  for (const t of templaterGroupSizes.slice(0, 10)) {
    console.log(`  ${t.distinctCount} distinct postings  "${t.sample.title}" @ ${t.sample.company}`);
  }

  if (!apply) {
    console.log("\nDry run only — nothing written. Re-run with --apply to write content_identity_key (safe/additive).");
    console.log("Add --dedupe on top of --apply to ALSO hide the confirmed duplicate pairs above (is_active = false) — a real, visible change, kept separate on purpose.");
    await client.end();
    return;
  }

  console.log("\nWriting identity columns...");
  for (let i = 0; i < keyUpdates.length; i += BATCH_SIZE) {
    const batch = keyUpdates.slice(i, i + BATCH_SIZE);
    await client.query(
      `UPDATE jobs AS j SET content_identity_key = v.key, title_location_key = v.tl_key
       FROM (SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::text[]) AS t(id, key, tl_key)) AS v
       WHERE j.id = v.id`,
      [batch.map((u) => u.id), batch.map((u) => u.key), batch.map((u) => u.tlKey)]
    );
    console.log(`  updated ${Math.min(i + BATCH_SIZE, keyUpdates.length)}/${keyUpdates.length}`);
  }

  // The review trail goes in regardless of --dedupe: knowing which pairs were
  // detected is useful on its own, and is what makes hiding auditable and
  // reversible (see --undo below). Idempotent via the unique pair index from
  // migration 100, so re-running never accumulates rows.
  console.log("\nRecording detected pairs in the job_duplicates review queue...");
  for (let i = 0; i < dedupeUpdates.length; i += BATCH_SIZE) {
    const batch = dedupeUpdates.slice(i, i + BATCH_SIZE);
    await client.query(
      `INSERT INTO job_duplicates (canonical_job_id, duplicate_job_id, similarity_score, resolved)
       SELECT t.canonical, t.dup, $3::numeric, false
       FROM UNNEST($1::uuid[], $2::uuid[]) AS t(canonical, dup)
       ON CONFLICT (canonical_job_id, duplicate_job_id) DO NOTHING`,
      [batch.map((u) => u.existing.id), batch.map((u) => u.id), CONTENT_IDENTITY_MATCH_SCORE]
    );
    console.log(`  queued ${Math.min(i + BATCH_SIZE, dedupeUpdates.length)}/${dedupeUpdates.length}`);
  }

  if (dedupe) {
    console.log("\n--dedupe passed: hiding confirmed historical duplicate pairs...");
    for (let i = 0; i < dedupeUpdates.length; i += BATCH_SIZE) {
      const batch = dedupeUpdates.slice(i, i + BATCH_SIZE);
      await client.query(
        `UPDATE jobs AS j SET is_active = false, content_duplicate_of = v.orig, content_duplicate_reason = v.reason
         FROM (SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::text[]) AS t(id, orig, reason)) AS v
         WHERE j.id = v.id`,
        [batch.map((u) => u.id), batch.map((u) => u.existing.id), batch.map((u) => describeReason(u.existing))]
      );
      console.log(`  hid ${Math.min(i + BATCH_SIZE, dedupeUpdates.length)}/${dedupeUpdates.length}`);
    }
  } else {
    console.log("\n--dedupe not passed: pairs are queued for review but NOT hidden. Nothing was deactivated.");
  }

  console.log("\nDone. No row was deleted or merged. Everything this script did is reversible with --undo.");
  await client.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
