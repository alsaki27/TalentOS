// READ-ONLY. npx tsx --env-file=.env.local scratch/check_falood_saved_applications.ts
import { query } from "../src/server/db/neon";

const IDS = ["53de6ed1-d976-4688-80a5-debb1c8e7179", "4f87c16c-0233-48a2-9e00-3e917dd356d3"];

async function main() {
  const rows = await query<any>(
    `SELECT id, name, job_description, company_name, candidate_id, resume_data, created_at, updated_at
     FROM falood_saved_applications WHERE id = ANY($1::uuid[])`,
    [IDS]
  );
  for (const r of rows) {
    console.log(`\n=== ${r.id} ===`);
    console.log("name:", r.name, " company_name:", r.company_name, " candidate_id:", r.candidate_id);
    console.log("created_at:", r.created_at, " updated_at:", r.updated_at);
    const rd = typeof r.resume_data === "string" ? JSON.parse(r.resume_data) : r.resume_data;
    console.log("resumeData.header/personalInfo:", JSON.stringify(rd?.header ?? rd?.personalInfo, null, 2));
    console.log("resumeData.experience[0]:", JSON.stringify(rd?.experience?.[0], null, 2));
  }
  if (rows.length === 0) console.log("Neither ID found in falood_saved_applications either.");
}
main().catch((e) => { console.error(e); process.exit(1); });
