// npx tsx --env-file=.env.local scratch/confirm_second_sync.ts
import { queryOne } from "../src/server/db/neon";
async function main() {
  const row = await queryOne<{ content: any }>("SELECT content FROM base_resumes WHERE id = $1", ["40b3750b-8ea6-4613-bffe-56021ad2e1ef"]);
  console.log(JSON.stringify(row?.content?.header, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
