import { neon } from '@neondatabase/serverless';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile(path) {
  if (!existsSync(path)) return null;
  const values = {};
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const env = loadEnvFile(resolve(process.cwd(), ".env.local")) || {};
const dbUrl = env.DATABASE_URL || process.env.DATABASE_URL;
const sql = neon(dbUrl);

async function run() {
  const filePath = process.argv[2] || 'sql/neon_fixes/041_falood_applications_versions.sql';
  const query = readFileSync(filePath, 'utf8');
  await sql.query(query);
  console.log(`Migration applied: ${filePath}`);
}
run();
