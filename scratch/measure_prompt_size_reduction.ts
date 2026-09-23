import { query, queryOne } from "../src/server/db/neon";
import { buildResumeForgePrompt } from "../src/lib/ai/application-agents/prompts/resumeForge";

async function main() {
  // Find the base resume with the most experience entries/bullets (largest realistic case)
  const rows = await query<any>(`
    SELECT id, content, jsonb_array_length(content->'experience') as exp_count
    FROM base_resumes
    WHERE jsonb_typeof(content->'experience') = 'array'
    ORDER BY exp_count DESC NULLS LAST
    LIMIT 3
  `);
  for (const r of rows) {
    const content = typeof r.content === "string" ? JSON.parse(r.content) : r.content;
    const prompt = buildResumeForgePrompt(
      { title: "Test Job", company: "Test Co", description_text: "A".repeat(500) },
      { content },
      [],
      { requirementAnalysis: [] },
      [],
      { confirmedSkills: [], notesContext: null }
    );
    console.log(`base_resume ${r.id}: exp_count=${r.exp_count}, total prompt length=${prompt.length} chars`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
