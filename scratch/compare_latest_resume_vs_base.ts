// READ-ONLY. npx tsx --env-file=.env.local scratch/compare_latest_resume_vs_base.ts
import { queryOne } from "../src/server/db/neon";

async function main() {
  const latest = await queryOne<{ content: any; created_at: string }>(
    "SELECT content, created_at FROM application_resume_versions WHERE id = $1",
    ["558323bb-0926-4608-851d-94736cd2d66c"]
  );
  const base = await queryOne<{ content: any; updated_at: string }>(
    "SELECT content, updated_at FROM base_resumes WHERE id = $1",
    ["e4efba67-2cfb-45bc-997b-13c6f9e95eb9"]
  );
  console.log("Latest tailored resume created_at:", latest?.created_at);
  console.log("Base resume updated_at:", base?.updated_at);
  console.log("\n--- latest tailored resume header ---");
  console.log(JSON.stringify(latest?.content?.header, null, 2));
  console.log("\n--- current base resume header ---");
  console.log(JSON.stringify(base?.content?.header, null, 2));
  console.log("\n--- latest tailored resume experience[0] identity ---");
  const e = latest?.content?.experience?.[0];
  console.log(JSON.stringify({ title: e?.title, company: e?.company, location: e?.location, startDate: e?.startDate, endDate: e?.endDate }, null, 2));
  console.log("\n--- current base resume experience[0] identity ---");
  const be = base?.content?.experience?.[0];
  console.log(JSON.stringify({ title: be?.title, company: be?.company, location: be?.location, startDate: be?.startDate, endDate: be?.endDate }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
