import { Client } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { resolve } from "path";

// read .env.local manually
const envPath = resolve(process.cwd(), ".env.local");
const envFile = readFileSync(envPath, "utf-8");
let dbUrl = "";
envFile.split("\n").forEach(line => {
  if (line.startsWith("DATABASE_URL=")) {
    dbUrl = line.split("=")[1].replace(/['"]/g, "").trim();
  }
});

const url = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? dbUrl;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

async function applyFile(client, filename) {
  console.log(`Applying ${filename}...`);
  const migrationPath = resolve(process.cwd(), "sql/neon_fixes", filename);
  let sql = readFileSync(migrationPath, "utf-8");
  
  // Strip BOM if present
  if (sql.charCodeAt(0) === 0xFEFF) {
    sql = sql.slice(1);
  }

  try {
    await client.query(sql);
    console.log(`${filename} -> OK`);
  } catch (e) {
    console.error(`ERR in ${filename}:`, e.message);
  }
}

async function main() {
  const client = new Client(url);
  await client.connect();

  await applyFile(client, "034_job_ceo.sql");

  const res = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'description_enrich_attempts'`
  );
  if (res.rows.length > 0) {
    console.log("SUCCESS: description_enrich_attempts exists in jobs table.");
  } else {
    console.error("FAILED: description_enrich_attempts not found.");
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
