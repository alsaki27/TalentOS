import { query } from "../src/server/db/neon";
async function main() {
  const rows = await query<{ name: string; job_description: string | null; company_name: string | null }>(
    `SELECT name, job_description, company_name FROM falood_saved_applications
     WHERE name LIKE 'application_resume_version:%' ORDER BY updated_at DESC LIMIT 5`
  );
  rows.forEach((r) => {
    console.log(`name=${r.name}`);
    console.log(`  job_description (len=${r.job_description?.length ?? 0}): ${JSON.stringify(r.job_description)}`);
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
