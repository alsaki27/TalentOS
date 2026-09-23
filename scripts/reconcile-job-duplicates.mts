// scripts/reconcile-job-duplicates.mts
//
// Brings the jobs table's duplicate-detection data into agreement with the code
// that reads it. Three jobs, in this order:
//
//   1. Re-stamp content_identity_key and title_location_key on every row in the
//      guard's rolling window. This is not cosmetic - the guard matches with
//      exact string equality (WHERE content_identity_key = $1), so if the stored
//      keys were written by a different version of the key function than the one
//      running now, NO lookup can ever succeed and cross-platform detection is
//      silently doing nothing. That is exactly the state this script was written
//      to repair.
//   2. Backfill job_identities (migration 101) so historical rows participate in
//      identity-overlap matching, not just newly inserted ones.
//   3. Report - and with --dedupe, act on - duplicate pairs among existing rows,
//      applying the same rules as the live guard.
//
// Scoped to the last CONTENT_DUPLICATE_CHECK_WINDOW_DAYS, imported from the guard
// rather than re-hardcoded. That is the only correct scope: the guard's own
// lookups filter to that same window, so stamping keys on older rows would write
// data nothing will ever read.
//
// Everything is dry-run by default, idempotent, and re-runnable.
//
// Usage:
//   npx tsx scripts/reconcile-job-duplicates.mts                    # dry run, writes nothing
//   npx tsx scripts/reconcile-job-duplicates.mts --apply            # stamp keys + identities, queue findings, hide nothing
//   npx tsx scripts/reconcile-job-duplicates.mts --apply --dedupe   # also hide the confirmed pairs
//   npx tsx scripts/reconcile-job-duplicates.mts --undo             # dry run of the reversal
//   npx tsx scripts/reconcile-job-duplicates.mts --undo --apply     # un-hide everything this system hid, clear the queue

import { getDbClient } from "./lib/db.mjs";
import {
  computeContentIdentityKey,
  computeTitleLocationKey,
  companyNameAppearsInText,
  isSiteNameNotEmployer,
} from "../src/lib/jobContentIdentity";
import { extractAllIdentities, extractPlatformNamespace } from "../src/lib/jobUrlFingerprint";
import {
  CONTENT_DUPLICATE_CHECK_WINDOW_DAYS,
  CONTENT_IDENTITY_MATCH_SCORE,
  TITLE_LOCATION_MATCH_SCORE,
} from "../src/server/services/jobContentDuplicateGuard";

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
  description_text: string | null;
  work_mode: string | null;
  source: string | null;
  created_at: string;
}

const urlOf = (r: JobRow) => r.apply_url ?? r.source_url ?? null;
// Deliberately NOT derived from work_mode - that column is trigger-maintained, so
// reading it here would make the keys change every time they are written. See the
// note on identityInputs() in jobsRepository.ts.
const isRemoteOf = (_r: JobRow) => null;

function keysFor(r: JobRow) {
  return {
    contentIdentityKey: computeContentIdentityKey({
      title: r.title,
      company: r.company,
      location: r.location,
      url: urlOf(r),
      isRemote: isRemoteOf(r),
    }),
    titleLocationKey: computeTitleLocationKey({
      title: r.title,
      location: r.location,
      isRemote: isRemoteOf(r),
    }),
  };
}

function describeReason(existing: JobRow, basis: string): string {
  const seen = new Date(existing.created_at).toISOString().slice(0, 10);
  return `Auto-hidden: matched job ${existing.id}${existing.source ? ` (source: ${existing.source})` : ""} on ${basis}, first captured ${seen}. Review and re-activate if this is actually a distinct opening.`;
}

async function main() {
  // Driver picked from the connection string, so this works against either
  // database without an edit (see scripts/lib/db.mjs).
  const client = await getDbClient();

  const cols = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'jobs' AND column_name IN ('content_identity_key','title_location_key','work_mode')`
  );
  const present = new Set(cols.rows.map((r) => r.column_name));
  const hasIdentityTable =
    (await client.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'job_identities'`)).rows.length > 0;
  const schemaReady = present.has("content_identity_key") && present.has("title_location_key") && hasIdentityTable;

  if (!schemaReady) {
    console.log("NOTE: migrations 099/101 have not fully run against this database yet.");
    console.log(`  content_identity_key: ${present.has("content_identity_key")}`);
    console.log(`  title_location_key:   ${present.has("title_location_key")}`);
    console.log(`  job_identities table: ${hasIdentityTable}`);
    console.log("A dry run still works (everything is computed in memory); --apply will refuse.\n");
  }

  // ── --undo ─────────────────────────────────────────────────────────────────
  // Reverses every hide this system made, using content_duplicate_of as the
  // record of what it touched, and DELETES the queue rows.
  //
  // Deleting rather than marking them resolved is deliberate: `resolved` means "a
  // human dealt with this", and the re-detect insert is ON CONFLICT DO NOTHING,
  // so a withdrawn finding marked resolved would stick in the table and could
  // never be re-raised even while still true. The queue holds nothing but this
  // detector's own regenerable output.
  if (undo) {
    const hidden = await client.query<{ c: string }>(
      `SELECT COUNT(*) c FROM jobs WHERE content_duplicate_of IS NOT NULL`
    );
    const queued = await client.query<{ c: string }>(`SELECT COUNT(*) c FROM job_duplicates`);
    console.log(`--undo: ${hidden.rows[0].c} row(s) are hidden; ${queued.rows[0].c} row(s) in the review queue.`);
    if (!apply) {
      console.log("Dry run - nothing written. Re-run with --undo --apply to restore them.");
      await client.end();
      return;
    }
    const restored = await client.query(
      `UPDATE jobs SET is_active = true, content_duplicate_of = NULL, content_duplicate_reason = NULL
       WHERE content_duplicate_of IS NOT NULL RETURNING id`
    );
    const dropped = await client.query(`DELETE FROM job_duplicates RETURNING id`);
    console.log(`Restored ${restored.rowCount} row(s) to is_active = true and cleared ${dropped.rowCount} queue row(s).`);
    console.log("Identity keys and job_identities are left in place - they are lookup data, not decisions.");
    await client.end();
    return;
  }

  const { rows } = await client.query<JobRow>(
    `SELECT id, title, company, location, apply_url, source_url, apply_link_fingerprint, source, created_at,
            ${present.has("work_mode") ? "work_mode" : "NULL AS work_mode"},
            ${present.has("content_identity_key") ? "content_identity_key" : "NULL AS content_identity_key"},
            ${present.has("title_location_key") ? "title_location_key" : "NULL AS title_location_key"}
     FROM jobs
     WHERE created_at >= NOW() - make_interval(days => $1)
     ORDER BY created_at ASC, id ASC`,
    [CONTENT_DUPLICATE_CHECK_WINDOW_DAYS]
  );
  // Every row in the window gets its keys stamped, including rows with no
  // fingerprint: they cannot be a match TARGET (the guard requires one), but a
  // stale key on them would become wrong the moment one is added, and leaving
  // them unstamped makes "do the stored keys agree with the code" unverifiable.
  // Pair detection below still considers only fingerprinted rows.
  const fingerprinted = rows.filter((r) => r.apply_link_fingerprint !== null);
  console.log(
    `Loaded ${rows.length} rows from the last ${CONTENT_DUPLICATE_CHECK_WINDOW_DAYS} days (the guard's own window); ${fingerprinted.length} carry a fingerprint.`
  );

  if (apply && !schemaReady) {
    console.error("Refusing to --apply until migrations 099/101 have run. Deploy them first.");
    await client.end();
    process.exit(1);
  }

  // ── 1. identity keys ───────────────────────────────────────────────────────
  const keyUpdates: { id: string; key: string | null; tlKey: string | null }[] = [];
  const byKey = new Map<string, JobRow[]>();
  const byTitleLocation = new Map<string, JobRow[]>();
  const unusableCompany: JobRow[] = [];

  for (const row of rows) {
    const { contentIdentityKey, titleLocationKey } = keysFor(row);
    if (row.content_identity_key !== contentIdentityKey || row.title_location_key !== titleLocationKey) {
      keyUpdates.push({ id: row.id, key: contentIdentityKey, tlKey: titleLocationKey });
    }
    if (row.apply_link_fingerprint === null) continue; // stamped, but never a match target
    if (titleLocationKey) {
      if (!byTitleLocation.has(titleLocationKey)) byTitleLocation.set(titleLocationKey, []);
      byTitleLocation.get(titleLocationKey)!.push(row);
    }
    if (!contentIdentityKey) {
      if (titleLocationKey) unusableCompany.push(row);
      continue;
    }
    if (!byKey.has(contentIdentityKey)) byKey.set(contentIdentityKey, []);
    byKey.get(contentIdentityKey)!.push(row);
  }
  console.log(`\nIdentity keys: ${keyUpdates.length} of ${rows.length} row(s) need updating.`);

  // ── 2. identity graph ──────────────────────────────────────────────────────
  const identityRows: { jobId: string; identity: string; kind: string }[] = [];
  for (const row of fingerprinted) {
    for (const i of extractAllIdentities([row.apply_url, row.source_url])) {
      identityRows.push({ jobId: row.id, identity: i.identity, kind: i.kind });
    }
  }
  console.log(`Identity graph: ${identityRows.length} (job, identity) pair(s) derivable from existing urls.`);

  // ── 3. duplicate pairs ─────────────────────────────────────────────────────
  const samePlatform = (a: JobRow, b: JobRow) => {
    const na = extractPlatformNamespace(a.apply_link_fingerprint);
    const nb = extractPlatformNamespace(b.apply_link_fingerprint);
    return !!na && !!nb && na === nb;
  };
  const distinctPostings = (group: JobRow[]) => {
    const m = new Map<string, JobRow>();
    for (const r of group) if (!m.has(r.apply_link_fingerprint!)) m.set(r.apply_link_fingerprint!, r);
    return [...m.values()];
  };

  const hides: { id: string; existing: JobRow; score: number; basis: string }[] = [];
  const skippedSamePlatform: { a: JobRow; b: JobRow }[] = [];

  // Primary path: exactly two distinct postings under one company+title+location.
  for (const group of byKey.values()) {
    const distinct = distinctPostings(group);
    if (distinct.length !== 2) continue;
    const [original, newer] = distinct; // query ordered oldest-first
    if (samePlatform(original, newer)) {
      skippedSamePlatform.push({ a: original, b: newer });
      continue;
    }
    hides.push({ id: newer.id, existing: original, score: CONTENT_IDENTITY_MATCH_SCORE, basis: "company+title+location" });
  }

  // Fallback path: rows whose company is the site's own name. Same rules the live
  // guard applies there - exactly one corroborating counterpart with a trustworthy
  // employer name, on a different platform, whose name appears in this row's text.
  const fallbackSkipReasons = new Map<string, number>();
  for (const row of unusableCompany) {
    const note = (reason: string) => fallbackSkipReasons.set(reason, (fallbackSkipReasons.get(reason) ?? 0) + 1);
    if (!row.description_text) {
      note("no description to corroborate with");
      continue;
    }
    const siblings = (byTitleLocation.get(row.title_location_key ?? keysFor(row).titleLocationKey!) ?? []).filter(
      (other) =>
        other.id !== row.id &&
        !isSiteNameNotEmployer(other.company, urlOf(other)) &&
        keysFor(other).contentIdentityKey !== null &&
        companyNameAppearsInText(other.company, row.description_text)
    );
    const distinct = distinctPostings(siblings);
    if (distinct.length !== 1) {
      note(`${distinct.length} corroborating counterpart(s), need exactly 1`);
      continue;
    }
    if (samePlatform(distinct[0], row)) {
      note("same platform");
      continue;
    }
    // The row with the unusable employer name is always the one hidden - the row
    // that knows its real employer is the better record to keep.
    hides.push({ id: row.id, existing: distinct[0], score: TITLE_LOCATION_MATCH_SCORE, basis: "title+location+description" });
  }

  const reusedTitleGroups = [...byKey.values()]
    .map((g) => ({ n: distinctPostings(g).length, sample: g[0] }))
    .filter((g) => g.n >= 3)
    .sort((a, b) => b.n - a.n);

  const primary = hides.filter((h) => h.basis === "company+title+location");
  const fallback = hides.filter((h) => h.basis === "title+location+description");

  console.log(`\nConfirmed duplicate pairs: ${hides.length}`);
  console.log(`  via company+title+location, different platforms: ${primary.length}`);
  console.log(`  via title+location with the employer confirmed from the description: ${fallback.length}`);
  for (const h of hides.slice(0, 15)) {
    console.log(`    "${h.existing.title}" @ ${h.existing.company} - hide ${h.id} as a duplicate of ${h.existing.id}`);
  }
  if (hides.length > 15) console.log(`    ... and ${hides.length - 15} more`);

  console.log(`\nSkipped - both sides on the SAME platform, so that platform says they differ: ${skippedSamePlatform.length}`);
  for (const s of skippedSamePlatform.slice(0, 5)) {
    console.log(`  "${s.a.title}" @ ${s.a.company}: ${s.a.apply_link_fingerprint} vs ${s.b.apply_link_fingerprint}`);
  }
  if (fallbackSkipReasons.size) {
    console.log("\nSite-name-company rows left alone:");
    for (const [reason, n] of fallbackSkipReasons) console.log(`  ${n} x ${reason}`);
  }
  console.log(`\nLeft alone - 3+ distinct postings share one company+title+location: ${reusedTitleGroups.length} group(s)`);
  for (const g of reusedTitleGroups.slice(0, 8)) {
    console.log(`  ${g.n} postings  "${g.sample.title}" @ ${g.sample.company}`);
  }

  if (!apply) {
    console.log("\nDry run - nothing written.");
    console.log("  --apply           stamp identity keys + identity graph, queue findings, hide nothing");
    console.log("  --apply --dedupe  also hide the confirmed pairs above");
    await client.end();
    return;
  }

  console.log("\nWriting identity keys...");
  for (let i = 0; i < keyUpdates.length; i += BATCH_SIZE) {
    const b = keyUpdates.slice(i, i + BATCH_SIZE);
    await client.query(
      `UPDATE jobs AS j SET content_identity_key = v.key, title_location_key = v.tl_key
       FROM (SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::text[]) AS t(id, key, tl_key)) AS v
       WHERE j.id = v.id`,
      [b.map((u) => u.id), b.map((u) => u.key), b.map((u) => u.tlKey)]
    );
    console.log(`  ${Math.min(i + BATCH_SIZE, keyUpdates.length)}/${keyUpdates.length}`);
  }

  console.log("\nWriting the identity graph...");
  for (let i = 0; i < identityRows.length; i += BATCH_SIZE) {
    const b = identityRows.slice(i, i + BATCH_SIZE);
    await client.query(
      `INSERT INTO job_identities (job_id, identity, kind)
       SELECT t.job_id, t.identity, t.kind
       FROM UNNEST($1::uuid[], $2::text[], $3::text[]) AS t(job_id, identity, kind)
       ON CONFLICT (job_id, identity) DO NOTHING`,
      [b.map((r) => r.jobId), b.map((r) => r.identity), b.map((r) => r.kind)]
    );
    console.log(`  ${Math.min(i + BATCH_SIZE, identityRows.length)}/${identityRows.length}`);
  }

  // The review trail goes in regardless of --dedupe: knowing which pairs were
  // detected is useful on its own, and is what makes hiding auditable.
  console.log("\nQueueing findings for review...");
  for (let i = 0; i < hides.length; i += BATCH_SIZE) {
    const b = hides.slice(i, i + BATCH_SIZE);
    await client.query(
      `INSERT INTO job_duplicates (canonical_job_id, duplicate_job_id, similarity_score, resolved)
       SELECT t.canonical, t.dup, t.score, false
       FROM UNNEST($1::uuid[], $2::uuid[], $3::numeric[]) AS t(canonical, dup, score)
       ON CONFLICT (canonical_job_id, duplicate_job_id) DO NOTHING`,
      [b.map((h) => h.existing.id), b.map((h) => h.id), b.map((h) => h.score)]
    );
    console.log(`  ${Math.min(i + BATCH_SIZE, hides.length)}/${hides.length}`);
  }

  if (dedupe) {
    console.log("\n--dedupe: hiding the confirmed pairs...");
    for (let i = 0; i < hides.length; i += BATCH_SIZE) {
      const b = hides.slice(i, i + BATCH_SIZE);
      await client.query(
        `UPDATE jobs AS j
         SET is_active = false, content_duplicate_of = v.orig, content_duplicate_reason = v.reason
         FROM (SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::text[]) AS t(id, orig, reason)) AS v
         WHERE j.id = v.id`,
        [b.map((h) => h.id), b.map((h) => h.existing.id), b.map((h) => describeReason(h.existing, h.basis))]
      );
      console.log(`  ${Math.min(i + BATCH_SIZE, hides.length)}/${hides.length}`);
    }
  } else {
    console.log("\n--dedupe not passed: pairs are queued for review but NOT hidden. Nothing was deactivated.");
  }

  console.log("\nDone. Nothing was deleted or merged; every hide is reversible with --undo.");
  await client.end();
}

main().catch((err) => {
  console.error("Reconcile failed:", err);
  process.exit(1);
});
