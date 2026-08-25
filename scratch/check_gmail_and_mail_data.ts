// READ-ONLY. npx tsx --env-file=.env.local scratch/check_gmail_and_mail_data.ts
import { query } from "../src/server/db/neon";

async function main() {
  const connections = await query<any>(
    `SELECT candidate_id, integration_email, status, updated_at FROM integration_accounts
     WHERE provider = 'gmail' AND owner_type = 'candidate' ORDER BY updated_at DESC LIMIT 10`
  );
  console.log("Real candidate Gmail connections (integration_accounts):", JSON.stringify(connections, null, 2));

  const totalMail = await query<{ count: string }>("SELECT COUNT(*) as count FROM email_communications");
  console.log("\nTotal email_communications rows:", totalMail[0]?.count);

  const relevantMail = await query<{ count: string }>("SELECT COUNT(*) as count FROM email_communications WHERE ai_relevant = true");
  console.log("ai_relevant=true rows:", relevantMail[0]?.count);

  // Check what role scoping might apply - look for any candidate<->AE assignment concept
  const myProfile = await query<any>("SELECT user_id, role FROM profiles WHERE email = $1", ["qa-test-claude@talentos.local"]);
  console.log("\nMy QA account:", JSON.stringify(myProfile, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
