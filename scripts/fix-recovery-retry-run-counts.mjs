// One-time cleanup for recovery_retry job_ceo_runs created before the
// 2026-10-27 fix to jobCeoRecoveryRetryService.ts (which now calls
// bumpRunCounts itself — see retryOneRow's success branch). Before that fix,
// every recovery_retry run was left at its all-zero counter defaults
// regardless of what actually happened to the job.
//
// This does two things, both scoped to trigger_type = 'recovery_retry':
//   1. Deletes runs with zero attached job_ceo_staging rows — these are
//      fully orphaned (the retry fetched/extracted content, spending real
//      AI tokens, but failed to persist before the migration was applied;
//      see the 2026-10-26 "column does not exist" incident).
//   2. Backfills ingested_count=1, researched_count=1 on runs that DO have
//      an attached row but still show ingested_count=0 — these are real,
//      successful recoveries whose counters were simply never set. Any
//      kept_count/logged_count a later QA/Matchmaker step already set
//      correctly is left untouched.
//
// Safe to run more than once — both conditions are naturally idempotent.
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}
const env = { ...loadEnvFile(resolve(process.cwd(), ".env")), ...loadEnvFile(resolve(process.cwd(), ".env.local")) };
const DATABASE_URL = process.env.DATABASE_URL || env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is missing"); process.exit(1); }

const databaseUrl = new URL(DATABASE_URL);
databaseUrl.searchParams.delete("sslmode");
const client = new pg.Client({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false } });

async function run() {
  await client.connect();
  try {
    const deleted = await client.query(`
      DELETE FROM job_ceo_runs
      WHERE trigger_type = 'recovery_retry'
        AND NOT EXISTS (SELECT 1 FROM job_ceo_staging WHERE run_id = job_ceo_runs.id)
      RETURNING id, source, created_at
    `);
    console.log(`Deleted ${deleted.rowCount} fully orphaned recovery_retry run(s):`);
    console.log(JSON.stringify(deleted.rows, null, 2));

    const backfilled = await client.query(`
      UPDATE job_ceo_runs
      SET ingested_count = 1, researched_count = 1
      WHERE trigger_type = 'recovery_retry'
        AND ingested_count = 0
        AND EXISTS (SELECT 1 FROM job_ceo_staging WHERE run_id = job_ceo_runs.id)
      RETURNING id, source, kept_count, logged_count, created_at
    `);
    console.log(`\nBackfilled counters on ${backfilled.rowCount} real recovery_retry run(s):`);
    console.log(JSON.stringify(backfilled.rows, null, 2));
  } finally {
    await client.end();
  }
}
run().catch((err) => { console.error(err); process.exit(1); });
