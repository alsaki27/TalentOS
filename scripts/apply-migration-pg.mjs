// Applies one sql/neon_fixes/*.sql file via a direct pg connection - the
// repo's DB is self-hosted Postgres on a VPS, not Neon's cloud HTTP driver
// that scripts/apply-migration.mjs assumes (that script is stale).
import pg from "pg";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const { Pool } = pg;

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
// .env.local takes precedence over .env, matching Next.js's own load order.
const env = { ...loadEnvFile(resolve(process.cwd(), ".env")), ...loadEnvFile(resolve(process.cwd(), ".env.local")) };
const DATABASE_URL = process.env.TALENTOS_DATABASE_URL || process.env.DATABASE_URL || env.TALENTOS_DATABASE_URL || env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is missing"); process.exit(1); }

const filePath = process.argv[2];
if (!filePath) { console.error("Usage: node scripts/apply-migration-pg.mjs <path/to.sql>"); process.exit(1); }

const databaseUrl = new URL(DATABASE_URL);
databaseUrl.searchParams.delete("sslmode");
const pool = new Pool({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false } });

async function run() {
  const sql = readFileSync(filePath, "utf8");
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log(`Migration applied: ${filePath}`);
  } finally {
    client.release();
    await pool.end();
  }
}
run().catch((err) => { console.error(err); process.exit(1); });
