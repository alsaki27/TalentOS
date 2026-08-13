// READ-ONLY diagnostic. No writes, no schema changes. Finds the resume tied
// to Avirup Bhattacharjee's application to job 069455c5-8ad6-4c49-bc8d-83966c98b2e9.
import { query } from "../src/server/db/neon";

const JOB_ID = "069455c5-8ad6-4c49-bc8d-83966c98b2e9";

async function main() {
  const candidates = await query<any>(
    `SELECT id, name, email FROM candidates WHERE name ILIKE '%avirup%' LIMIT 5`
  );
  console.log("CANDIDATES:", JSON.stringify(candidates, null, 2));
  if (candidates.length === 0) return;
  const candidateId = candidates[0].id;

  const applications = await query<any>(
    `SELECT id, candidate_id, job_id, status, resume_url, resume_filename, resume_id, applied_at
     FROM applications WHERE candidate_id = $1 AND job_id = $2`,
    [candidateId, JOB_ID]
  );
  console.log("APPLICATIONS:", JSON.stringify(applications, null, 2));

  const resumeVersions = await query<any>(
    `SELECT id, candidate_id, base_resume_id, source_resume_id, target_job_id, title, version_label,
            status, source_type, ats_score, truth_score, one_page_fit_score, created_at, updated_at,
            LENGTH(generated_text) AS generated_text_length
     FROM application_resume_versions WHERE candidate_id = $1 AND target_job_id = $2
     ORDER BY created_at DESC`,
    [candidateId, JOB_ID]
  ).catch((e) => ({ error: e.message }));
  console.log("APPLICATION_RESUME_VERSIONS:", JSON.stringify(resumeVersions, null, 2));

  if (applications.length > 0) {
    const packet = await query<any>(
      `SELECT * FROM application_packets WHERE application_id = $1`,
      [applications[0].id]
    ).catch((e) => ({ error: e.message }));
    console.log("APPLICATION_PACKET:", JSON.stringify(packet, null, 2));
  }

  if (applications.length > 0 && applications[0].resume_id) {
    const resume = await query<any>(
      `SELECT id, candidate_id, filename, url, created_at FROM resumes WHERE id = $1`,
      [applications[0].resume_id]
    ).catch((e) => ({ error: e.message }));
    console.log("LINKED_RESUME_ROW:", JSON.stringify(resume, null, 2));
  }

  // Fallback: any resume versions for this candidate at all, regardless of target_job_id,
  // in case target_job_id was recorded differently than applications.job_id.
  const allVersions = await query<any>(
    `SELECT id, target_job_id, title, version_label, status, created_at FROM application_resume_versions
     WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [candidateId]
  ).catch((e) => ({ error: e.message }));
  console.log("ALL_RESUME_VERSIONS_FOR_CANDIDATE:", JSON.stringify(allVersions, null, 2));
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
