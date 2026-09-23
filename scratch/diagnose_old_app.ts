// READ-ONLY. Investigates application 09c10cb6-fb93-497b-b5ea-281c5b75b019
// (user reports it opens an old/deprecated resume builder) and Avirup
// Bhattacharjee's base resume date data (the "Jul 2025 - Jan 2001" bug).
import { query } from "../src/server/db/neon";

const APP_ID = "09c10cb6-fb93-497b-b5ea-281c5b75b019";

async function main() {
  const app = await query<any>(
    `SELECT a.id, a.candidate_id, a.job_id, a.status, a.source_type, a.resume_generation_status,
            a.tailored_resume_version_id, a.ae_stage, a.applied_at,
            c.name AS candidate_name
     FROM applications a JOIN candidates c ON c.id = a.candidate_id
     WHERE a.id = $1`,
    [APP_ID]
  );
  console.log("APPLICATION:", JSON.stringify(app, null, 2));

  if (app.length > 0 && app[0].tailored_resume_version_id) {
    const rv = await query<any>(
      `SELECT id, source_type, base_resume_id, status, created_at FROM application_resume_versions WHERE id = $1`,
      [app[0].tailored_resume_version_id]
    );
    console.log("RESUME_VERSION:", JSON.stringify(rv, null, 2));
  }

  // Avirup's base resume - check the actual stored dates for the role that
  // shows "Jul 2025 - Jan 2001" in the tailored output.
  const avirup = await query<any>(
    `SELECT id FROM candidates WHERE name ILIKE '%avirup%' LIMIT 1`
  );
  if (avirup.length > 0) {
    const baseResumes = await query<any>(
      `SELECT id, created_at, content->'experience' AS experience
       FROM base_resumes WHERE candidate_id = $1 ORDER BY created_at DESC`,
      [avirup[0].id]
    );
    console.log("AVIRUP_BASE_RESUMES_EXPERIENCE:", JSON.stringify(baseResumes, null, 2));
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
