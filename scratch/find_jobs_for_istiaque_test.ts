// READ-ONLY. npx tsx --env-file=.env.local scratch/find_jobs_for_istiaque_test.ts
import { query } from "../src/server/db/neon";

async function main() {
  const jobs = await query<any>(
    `SELECT id, title, company, location, description_text, created_at
     FROM jobs
     WHERE description_text IS NOT NULL AND length(description_text) > 200
       AND (title ILIKE '%software%' OR title ILIKE '%developer%' OR title ILIKE '%engineer%' OR title ILIKE '%full stack%' OR title ILIKE '%full-stack%' OR title ILIKE '%backend%' OR title ILIKE '%node%')
       AND title NOT ILIKE '%test%'
     ORDER BY created_at DESC
     LIMIT 8`
  );
  console.log(JSON.stringify(jobs.map((j: any) => ({
    id: j.id, title: j.title, company: j.company, location: j.location,
    desc_len: j.description_text?.length ?? 0, created_at: j.created_at,
  })), null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
