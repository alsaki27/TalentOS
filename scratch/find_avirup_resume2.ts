// READ-ONLY diagnostic. No writes. Check the resumes table for Avirup's candidate id.
import { query } from "../src/server/db/neon";

const CANDIDATE_ID = "8966dfa1-356d-42e1-8fd3-1349a5098aee";

async function main() {
  const resumes = await query<any>(
    `SELECT id, candidate_id, label, kind, file_url, filename, created_at FROM resumes WHERE candidate_id = $1 ORDER BY created_at DESC`,
    [CANDIDATE_ID]
  );
  console.log("RESUMES:", JSON.stringify(resumes, null, 2));

  const baseResumes = await query<any>(
    `SELECT id, candidate_id, title, created_at FROM base_resumes WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [CANDIDATE_ID]
  ).catch((e) => ({ error: e.message }));
  console.log("BASE_RESUMES:", JSON.stringify(baseResumes, null, 2));
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
