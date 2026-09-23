// npx tsx --env-file=.env.local scratch/delete_qa_test_staff.ts
import { execute } from "../src/server/db/neon";
async function main() {
  await execute("DELETE FROM profiles WHERE email = $1", ["qa-test-claude@talentos.local"]);
  console.log("Deleted QA test staff account.");
}
main().catch((e) => { console.error(e); process.exit(1); });
