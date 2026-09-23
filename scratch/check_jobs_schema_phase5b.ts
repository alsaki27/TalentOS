import { query } from "../src/server/db/neon";
async function main() {
  const cols = await query<any>(`
    SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_name = 'jobs' AND (column_name LIKE 'job_analysis%' OR column_name LIKE 'description_enrich%')
    ORDER BY column_name
  `);
  console.log(JSON.stringify(cols, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
