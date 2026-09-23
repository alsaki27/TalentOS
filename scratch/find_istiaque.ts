import { query } from "../src/server/db/neon";
async function main() {
  const rows = await query<any>(`
    SELECT id, name, email, status, pipeline_stage, created_at
    FROM candidates
    WHERE name ILIKE '%Istiaque%' OR name ILIKE '%Shohan%'
    ORDER BY created_at DESC
  `);
  console.log(`Found ${rows.length} matching candidates`);
  for (const r of rows) console.log(JSON.stringify(r));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
