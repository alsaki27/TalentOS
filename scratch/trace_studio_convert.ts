import { query } from "../src/server/db/neon";
import { studioDocumentToResumeData } from "../src/lib/falood/studioDocumentToResumeData";

async function main() {
  const rows = await query<any>(`
    SELECT id, content FROM base_resumes WHERE id = '8737c7bc-5a5d-4ada-b139-9720dbb70e15'
  `);
  const c = typeof rows[0].content === "string" ? JSON.parse(rows[0].content) : rows[0].content;
  console.log("Raw certifications field:", JSON.stringify(c.certifications));
  console.log("Raw customSections field:", JSON.stringify(c.customSections)?.slice(0, 200));

  const result = studioDocumentToResumeData(c);
  console.log("\n=== CONVERTED customSections ===");
  console.log(JSON.stringify(result.customSections, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
