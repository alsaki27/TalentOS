import { query } from "../src/server/db/neon";

async function main() {
  const q = `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE (table_name='applications' AND column_name IN ('app_number'))
        OR (table_name='candidates' AND column_name IN ('candidate_number'))
        OR (table_name='jobs' AND column_name IN ('job_number'))
     ORDER BY table_name, column_name`;
  const rows = await query(q);
  for (const r of rows as any[]) console.log(r.table_name + "." + r.column_name + " -> " + r.data_type);
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
