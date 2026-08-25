import { query, queryOne } from "../src/server/db/neon";
async function main() {
  const appId = "d98dd36e-fce4-4225-90d0-b39a42dd15d7";
  const app = await queryOne<any>(`SELECT id, job_id, status FROM applications WHERE id = $1`, [appId]);
  console.log("application:", app);

  const byApplicationId = await query<any>(
    `SELECT id, application_id, target_job_id, source_type, created_at FROM application_resume_versions WHERE application_id = $1 ORDER BY created_at DESC`,
    [appId]
  );
  console.log("\nMatches via application_id (the fix):", byApplicationId.length);
  byApplicationId.forEach((r) => console.log(" -", r));
}
main().catch((e) => { console.error(e); process.exit(1); });
