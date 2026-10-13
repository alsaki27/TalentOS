// One-time backfill: derive candidates.timezone (and current_location, if unset) from
// each candidate's latest base resume's header location, for candidates added before this
// feature existed. Reuses the exact same mapper the live Add/Edit Candidate API routes use
// (imported directly, not re-implemented - Node 22+ loads .ts files natively, confirmed
// working on this repo's Node version, so there is zero risk of this script's logic
// drifting from what the app itself does for new candidates).
//
// Dry-run by default: prints the plan and exits. Pass --confirm to actually write.
import fs from "node:fs";
import pg from "pg";
import { deriveTimezoneFromLocation } from "../src/lib/usTimezoneFromLocation.ts";

const { Pool } = pg;

function getVar(file, name) {
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, "utf-8");
  const line = content.split(/\r?\n/).find((l) => l.startsWith(name + "="));
  if (!line) return null;
  return line.slice(name.length + 1).replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}

const DATABASE_URL = process.env.DATABASE_URL || getVar(".env", "DATABASE_URL") || getVar(".env.local", "DATABASE_URL");
const EXPECTED_DB_HOSTS = new Set(
  (process.env.MIX923_EXPECTED_DB_HOSTS || "40.160.139.188,172.18.0.2/32").split(",").map((v) => v.trim()).filter(Boolean)
);
const CONFIRM = process.argv.includes("--confirm");

async function main() {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is missing");

  const databaseUrl = new URL(DATABASE_URL);
  databaseUrl.searchParams.delete("sslmode");
  databaseUrl.searchParams.delete("channel_binding");
  const pool = new Pool({ connectionString: databaseUrl.toString(), max: 1, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    const dbIdentity = await client.query("select inet_server_addr()::text as server_addr, current_database() as database_name");
    if (!EXPECTED_DB_HOSTS.has(dbIdentity.rows[0]?.server_addr) || dbIdentity.rows[0]?.database_name !== "talentos") {
      throw new Error(`Refusing to mutate unexpected database: ${dbIdentity.rows[0]?.server_addr}/${dbIdentity.rows[0]?.database_name}`);
    }

    // Candidates with zero base_resumes at all - resume-based derivation is structurally
    // impossible for these; reported, not silently skipped.
    const noResume = await client.query(`
      SELECT c.id, c.name, c.email
      FROM candidates c
      WHERE NOT EXISTS (SELECT 1 FROM base_resumes br WHERE br.candidate_id = c.id)
      ORDER BY c.name
    `);

    // Candidates needing a timezone, with their latest base resume's header location.
    const candidates = await client.query(`
      SELECT c.id, c.name, c.current_location AS existing_location, latest.location AS resume_location
      FROM candidates c
      JOIN LATERAL (
        SELECT content->'header'->>'location' AS location
        FROM base_resumes br
        WHERE br.candidate_id = c.id
        ORDER BY br.created_at DESC
        LIMIT 1
      ) latest ON true
      WHERE c.timezone IS NULL
      ORDER BY c.name
    `);

    const toUpdate = [];
    const unparseable = [];
    for (const row of candidates.rows) {
      const locationText = row.existing_location || row.resume_location;
      if (!locationText) {
        unparseable.push({ ...row, reason: "no location text on resume or profile" });
        continue;
      }
      const { timezone } = deriveTimezoneFromLocation(locationText);
      if (!timezone) {
        unparseable.push({ ...row, reason: `could not resolve "${locationText}"` });
        continue;
      }
      toUpdate.push({ id: row.id, name: row.name, locationText, timezone });
    }

    console.log(`\n=== Candidates with zero base resumes (${noResume.rowCount}) — cannot derive from resume ===`);
    for (const row of noResume.rows) console.log(`  ${row.name}  (${row.email ?? "no email"})  id=${row.id}`);

    console.log(`\n=== Would update (${toUpdate.length}) ===`);
    for (const row of toUpdate) console.log(`  ${row.name}: "${row.locationText}" -> ${row.timezone}`);

    console.log(`\n=== Resume location present but unparseable (${unparseable.length}) — needs manual entry ===`);
    for (const row of unparseable) console.log(`  ${row.name}  (${row.reason})  id=${row.id}`);

    if (!CONFIRM) {
      console.log(`\nDry run only — no rows changed. Re-run with --confirm to apply the ${toUpdate.length} update(s) above.`);
      return;
    }

    await client.query("begin");
    for (const row of toUpdate) {
      await client.query(
        `UPDATE candidates SET timezone = $1, current_location = COALESCE(current_location, $2), updated_at = now() WHERE id = $3`,
        [row.timezone, row.locationText, row.id]
      );
    }
    await client.query(
      `INSERT INTO ai_admin_audit_log (actor_email, action, metadata) VALUES ($1, $2, $3::jsonb)`,
      ["backfill-candidate-timezones-from-resume", "candidate_timezones_backfilled", JSON.stringify({ updated: toUpdate.length, noResume: noResume.rowCount, unparseable: unparseable.length })]
    ).catch(() => {}); // Best-effort audit log; never block the real work on it.
    await client.query("commit");
    console.log(`\nUpdated ${toUpdate.length} candidate(s).`);
  } catch (error) {
    try { await client.query("rollback"); } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`backfill-candidate-timezones-from-resume failed: ${error.message}`);
  process.exitCode = 1;
});
