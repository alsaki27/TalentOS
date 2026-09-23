// READ-ONLY. Inspects the STRUCTURE of generated resume content to pin down
// the "Your Name" / missing-dates / missing-certifications bugs. Prints field
// presence and shapes, not full resume prose.
import { query } from "../src/server/db/neon";

const CANDIDATE_ID = "b893a59c-6c2f-43aa-bb1e-922808ce1a57"; // MD MAHBUBUL ALAM

async function main() {
  const versions = await query<any>(
    `SELECT id, target_job_id, title, status, source_type, created_at,
            jsonb_object_keys_arr AS top_level_keys,
            content->'header' AS header,
            content->'personalInfo' AS personal_info,
            jsonb_typeof(content->'experience') AS experience_type,
            content->'experience'->0 AS first_experience,
            jsonb_typeof(content->'skills') AS skills_type,
            jsonb_typeof(content->'certifications') AS certifications_type,
            content->'certifications' AS certifications
     FROM application_resume_versions,
          LATERAL (SELECT array_agg(k) AS jsonb_object_keys_arr FROM jsonb_object_keys(content) k) ks
     WHERE candidate_id = $1
     ORDER BY created_at DESC LIMIT 4`,
    [CANDIDATE_ID]
  );
  console.log(JSON.stringify(versions, null, 2));
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
