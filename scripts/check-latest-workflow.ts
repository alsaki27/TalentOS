import { query } from "@/server/db/neon";

async function main() {
  const wfs = await query(
    \`SELECT id, application_id, status, current_stage, last_error, created_at, completed_at
    FROM application_ai_workflows
    ORDER BY created_at DESC
    LIMIT 2\`
  );
  if (wfs.length === 0) { console.log('No workflows found'); return; }
  console.log('=== LATEST WORKFLOWS ===');
  console.log(JSON.stringify(wfs, null, 2));

  for (const wf of wfs) {
    const arts = await query(
      \`SELECT automation_id, sequence_number, schema_version, content_hash,
             length(data::text) as data_chars,
             (data->'experience') IS NOT NULL as has_experience,
             jsonb_array_length(COALESCE(data->'experience', '[]'::jsonb)) as experience_count,
             (SELECT count(*) FROM jsonb_array_elements(COALESCE(data->'experience', '[]'::jsonb)) exp WHERE jsonb_array_length(COALESCE(exp->'bullets', '[]'::jsonb)) > 0) as experience_with_bullets,
             jsonb_array_length(COALESCE(data->'skills', '[]'::jsonb)) as skills_count
      FROM application_ai_artifacts
      WHERE workflow_id = $1
      ORDER BY sequence_number\`,
      [wf.id]
    );
    console.log(\`\n=== ARTIFACTS FOR \${wf.id} ===\`);
    arts.forEach((a: any) => console.log(JSON.stringify(a)));
  }
}

main().catch(console.error);
