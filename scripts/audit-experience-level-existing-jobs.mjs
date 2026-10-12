// Read-only audit: fresher-roles-only product policy (jobCeoService.ts's new reject gate,
// EXPERIENCE_YEARS_MAX = 5) only applies to jobs ingested AFTER that change. Existing live
// jobs never had a stored years-of-experience value to check (job_ceo_staging.requirements
// isn't retained on the final jobs row), so this scans live jobs.description_text directly
// with a deterministic regex - same approach and pattern shape as
// scripts/openjobdata_common.py's extract_years_required()/YEARS_EXPERIENCE_PATTERN - to
// find existing postings that exceed the cap. Pure regex, zero AI calls, consistent with
// the AI-minimization goal. Read-only: prints a report, does not deactivate anything.
// Deactivating any match is a separate, explicit, human-reviewed follow-up step.
import fs from "node:fs";
import pg from "pg";

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
const EXPERIENCE_YEARS_MAX = 5;

// Same shape as openjobdata_common.py's YEARS_EXPERIENCE_PATTERN: "5+ years", "3-5 years" /
// "3 to 5 years", "minimum of 3 years" / "at least 4 years", "4 years [of] [relevant/
// related/professional/prior] experience". Takes the HIGHEST PLAUSIBLE number found; a
// description with no stated number is NOT treated as exceeding the cap - absence isn't
// evidence of it.
const YEARS_EXPERIENCE_PATTERN =
  /(\d{1,2})\s*\+\s*years|(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*years|(?:minimum\s+(?:of\s+)?|at\s+least\s+)(\d{1,2})\s*years|(\d{1,2})\s*years?\s*(?:of\s+)?(?:relevant\s+|related\s+|professional\s+|prior\s+)?experience/gi;

// A plausibility ceiling, not a policy knob: no genuine "years of experience required"
// figure realistically exceeds this. Scanning raw, unstructured description text (unlike
// jobCeoService.ts's gate, which scans a short AI-extracted phrase) is prone to picking up
// unrelated numbers near the word "years" - confirmed live: a real posting's "Over the past
// 80+ years, Buehler has established..." (the EMPLOYER's company history) outscored that
// same posting's actual, much lower, real requirement ("3-5 years of relevant experience")
// under a naive max-of-all-numbers approach, which would have wrongly flagged a job that's
// actually fine.
const PLAUSIBLE_MAX_YEARS = 40;

function extractYearsRequired(text) {
  if (!text) return null;
  const found = [];
  for (const m of text.matchAll(YEARS_EXPERIENCE_PATTERN)) {
    for (const g of m.slice(1)) {
      if (g) {
        const n = parseInt(g, 10);
        if (Number.isFinite(n) && n <= PLAUSIBLE_MAX_YEARS) found.push(n);
      }
    }
  }
  return found.length > 0 ? Math.max(...found) : null;
}

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
      throw new Error(`Refusing to read from unexpected database: ${dbIdentity.rows[0]?.server_addr}/${dbIdentity.rows[0]?.database_name}`);
    }

    const result = await client.query(
      `select id, title, company, description_text from jobs where source = 'openjobdata' and is_active = true`
    );
    console.log(`Scanned ${result.rowCount.toLocaleString()} active OpenJobData jobs.`);

    const overCap = [];
    for (const row of result.rows) {
      const years = extractYearsRequired(row.description_text || "");
      if (years !== null && years > EXPERIENCE_YEARS_MAX) {
        overCap.push({ id: row.id, title: row.title, company: row.company, years });
      }
    }

    console.log(`\n${overCap.length.toLocaleString()} job(s) state more than ${EXPERIENCE_YEARS_MAX} years of experience required:\n`);
    for (const job of overCap) {
      console.log(`  [${job.years} yrs] ${job.title} @ ${job.company}  (id=${job.id})`);
    }
    console.log(`\nThis is a read-only report. No rows were changed. Deactivating any of the above is a`);
    console.log(`separate, explicit step after manual review (a regex misread here would incorrectly`);
    console.log(`hide a real posting from staff).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`audit-experience-level-existing-jobs failed: ${error.message}`);
  process.exitCode = 1;
});
