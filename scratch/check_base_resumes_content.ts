// READ-ONLY. npx tsx --env-file=.env.local scratch/check_base_resumes_content.ts
import { queryOne } from "../src/server/db/neon";

async function main() {
  for (const id of ["e4efba67-2cfb-45bc-997b-13c6f9e95eb9", "40b3750b-8ea6-4613-bffe-56021ad2e1ef"]) {
    const row = await queryOne<{ content: any; updated_at: string }>(
      "SELECT content, updated_at FROM base_resumes WHERE id = $1", [id]
    );
    const pi = row?.content?.personalInfo ?? row?.content?.header ?? {};
    const exp0 = Array.isArray(row?.content?.experience) ? row.content.experience[0] : null;
    console.log(`\n=== ${id} (updated_at: ${row?.updated_at}) ===`);
    console.log("personalInfo:", JSON.stringify(pi, null, 2));
    console.log("experience[0]:", JSON.stringify({ title: exp0?.title, company: exp0?.company, location: exp0?.location, startDate: exp0?.startDate, endDate: exp0?.endDate }, null, 2));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
