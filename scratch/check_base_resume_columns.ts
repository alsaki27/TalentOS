// READ-ONLY. npx tsx --env-file=.env.local scratch/check_base_resume_columns.ts
import { query } from "../src/server/db/neon";

async function main() {
  const cols = await query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'base_resumes' ORDER BY ordinal_position"
  );
  console.log("base_resumes columns:", cols.map((c) => c.column_name));

  const all = await query<any>(
    "SELECT id, name, updated_at, updated_by, status FROM base_resumes WHERE candidate_id = $1",
    ["16ad4c1b-ef2f-4535-b7b4-c5115acfe09c"]
  );
  console.log("All base resumes for Test Istiaque:", JSON.stringify(all, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
