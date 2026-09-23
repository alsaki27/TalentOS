// Apply job_agent_tables migration to Neon
import { Client } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { resolve } from "path";

const url = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const migrationPath = resolve(process.cwd(), "migrations/job_agent_tables.sql");
const sql = readFileSync(migrationPath, "utf-8");

// Strip comments
const cleaned = sql
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*--.*$/gm, "");

const statements = cleaned
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

async function main() {
  const client = new Client(url);
  await client.connect();

  let ok = 0, skip = 0, err = 0;
  for (const stmt of statements) {
    try {
      await client.query(stmt);
      ok++;
    } catch (e) {
      const msg = e.message ?? "";
      if (msg.includes("already exists") || msg.includes("duplicate")) {
        skip++;
      } else {
        err++;
        console.error("ERR:", msg.slice(0, 120));
      }
    }
  }

  console.log(`Applied: OK=${ok} SKIP=${skip} ERR=${err}`);

  // Verify
  const res = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'job_agent_%' ORDER BY tablename`
  );
  console.log("Tables:", res.rows.map((r) => r.tablename).join(", "));

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });