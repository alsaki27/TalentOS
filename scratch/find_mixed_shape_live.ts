import { query } from "../src/server/db/neon";
async function main() {
  const rows = await query<any>(`
    SELECT id, candidate_id, name, updated_at
    FROM base_resumes
    WHERE content ? 'header'
      AND content->'customSections' IS NOT NULL
      AND jsonb_typeof(content->'customSections') = 'array'
      AND jsonb_array_length(content->'customSections') > 0
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(content->'customSections') cs
        WHERE cs ? 'content' AND NOT (cs ? 'bullets')
      )
    ORDER BY updated_at DESC
  `);
  console.log(`Live base_resumes currently in the mixed shape (would have been affected): ${rows.length}`);
  for (const r of rows) console.log(`  ${r.id}  candidate=${r.candidate_id}  name="${r.name}"  updated=${r.updated_at}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
