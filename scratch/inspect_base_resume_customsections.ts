import { query } from "../src/server/db/neon";
async function main() {
  const rows = await query<any>(`
    SELECT id, candidate_id, name, content, updated_at
    FROM base_resumes
    WHERE content->'customSections' IS NOT NULL
      AND jsonb_typeof(content->'customSections') = 'array'
      AND jsonb_array_length(content->'customSections') > 0
    ORDER BY updated_at DESC
    LIMIT 5
  `);
  console.log(`Found ${rows.length} base_resumes with non-empty customSections`);
  for (const r of rows) {
    console.log(`\n=== ${r.id} (candidate ${r.candidate_id}, name="${r.name}", updated ${r.updated_at}) ===`);
    const c = typeof r.content === "string" ? JSON.parse(r.content) : r.content;
    console.log("Top-level keys:", Object.keys(c));
    console.log("Has personalInfo?", !!c.personalInfo, " Has header?", !!c.header);
    console.log("customSections:", JSON.stringify(c.customSections, null, 2).slice(0, 1500));
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
