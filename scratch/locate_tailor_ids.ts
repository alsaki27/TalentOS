// READ-ONLY. npx tsx --env-file=.env.local scratch/locate_tailor_ids.ts
import { query } from "../src/server/db/neon";

const IDS = ["53de6ed1-d976-4688-80a5-debb1c8e7179", "4f87c16c-0233-48a2-9e00-3e917dd356d3"];

async function tryTable(table: string, idCol: string = "id") {
  try {
    const rows = await query<any>(`SELECT * FROM ${table} WHERE ${idCol} = ANY($1::uuid[])`, [IDS]);
    if (rows.length > 0) {
      console.log(`\n>>> FOUND in ${table} (${rows.length} row(s)) <<<`);
      for (const r of rows) {
        const { content, ...rest } = r;
        console.log(JSON.stringify(rest, null, 2));
        if (content) console.log("content.header/personalInfo:", JSON.stringify(content?.header ?? content?.personalInfo ?? null, null, 2));
      }
    } else {
      console.log(`${table}: not found`);
    }
  } catch (err: any) {
    console.log(`${table}: query failed (${err.message?.split("\n")[0]})`);
  }
}

async function main() {
  for (const table of [
    "base_resumes",
    "application_resume_versions",
    "target_jobs",
    "candidate_resume_drafts",
    "resume_drafts",
    "candidates",
  ]) {
    await tryTable(table);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
