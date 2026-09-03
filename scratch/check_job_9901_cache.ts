import { query } from "../src/server/db/neon";
async function main() {
  const rows = await query<any>(`SELECT id, job_analysis_schema_version, job_analysis IS NOT NULL as has_analysis, job_analysis_completed_at FROM jobs WHERE id = '9901ae99-4408-4d0a-8447-b3eb66ca614d'`);
  console.log(JSON.stringify(rows, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
