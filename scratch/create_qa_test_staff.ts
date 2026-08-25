// Creates ONE dedicated, clearly-labeled test staff account for QA/browser
// testing purposes (admin role, for max page access). Real login flow will
// be used afterward to get a genuine session cookie - nothing is bypassed.
// npx tsx --env-file=.env.local scratch/create_qa_test_staff.ts
import { queryOne } from "../src/server/db/neon";
import { hashPassword } from "../src/server/auth/crypto";

const EMAIL = "qa-test-claude@talentos.local";
const PASSWORD = "QaTest_Claude_2026_TempPW!";
const DISPLAY_NAME = "QA Test Account (Claude - temporary)";

async function main() {
  const existing = await queryOne<{ user_id: string }>("SELECT user_id FROM profiles WHERE email = $1", [EMAIL]);
  if (existing) {
    console.log("QA test account already exists:", existing.user_id);
    return;
  }
  const hash = await hashPassword(PASSWORD);
  const row = await queryOne<{ user_id: string }>(
    `INSERT INTO profiles (user_id, email, display_name, role, is_active, password_hash, email_verified, failed_login_attempts)
     VALUES (gen_random_uuid(), $1, $2, 'application_engineer', true, $3, true, 0)
     RETURNING user_id`,
    [EMAIL, DISPLAY_NAME, hash]
  );
  console.log("Created QA test account:", row?.user_id, EMAIL);
}
main().catch((e) => { console.error(e); process.exit(1); });
