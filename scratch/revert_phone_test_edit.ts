// npx tsx --env-file=.env.local scratch/revert_phone_test_edit.ts
import { queryOne, execute } from "../src/server/db/neon";

async function main() {
  const before = await queryOne<{ content: any }>(
    "SELECT content FROM base_resumes WHERE id = $1", ["e4efba67-2cfb-45bc-997b-13c6f9e95eb9"]
  );
  const restored = { ...before!.content, header: { ...before!.content.header, phone: "(269) 312-1996" } };
  await execute(
    "UPDATE base_resumes SET content = $1::jsonb, updated_at = $2, updated_by = $3 WHERE id = $4",
    [JSON.stringify(restored), "2026-08-20T11:01:16.336Z", "cbabf86c-6d0a-487c-a709-deea4314a2a0", "e4efba67-2cfb-45bc-997b-13c6f9e95eb9"]
  );
  const after = await queryOne<{ content: any; updated_at: string }>(
    "SELECT content, updated_at FROM base_resumes WHERE id = $1", ["e4efba67-2cfb-45bc-997b-13c6f9e95eb9"]
  );
  console.log("Restored phone:", after?.content.header.phone, " updated_at:", after?.updated_at);
}
main().catch((e) => { console.error(e); process.exit(1); });
