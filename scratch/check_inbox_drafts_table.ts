// READ-ONLY. npx tsx --env-file=.env.local scratch/check_inbox_drafts_table.ts
import { query } from "../src/server/db/neon";

async function main() {
  const tableExists = await query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'inbox_drafts') as exists"
  );
  console.log("inbox_drafts table exists:", tableExists[0]?.exists);
  if (tableExists[0]?.exists) {
    const cols = await query<{ column_name: string; data_type: string }>(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'inbox_drafts' ORDER BY ordinal_position"
    );
    console.log(JSON.stringify(cols, null, 2));
  }

  console.log("\n--- action_items handover-related columns ---");
  const aiCols = await query<{ column_name: string; data_type: string }>(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'action_items' AND column_name ILIKE '%assign%'"
  );
  console.log(JSON.stringify(aiCols, null, 2));

  console.log("\n--- Any existing team_handover action_items ---");
  const handovers = await query<any>("SELECT COUNT(*) as count FROM action_items WHERE type = 'team_handover'");
  console.log(JSON.stringify(handovers, null, 2));

  console.log("\n--- gmail_accounts table (candidate Gmail connections) ---");
  const gmailAccounts = await query<any>(
    "SELECT candidate_id, gmail_email, status FROM gmail_accounts ORDER BY updated_at DESC LIMIT 10"
  ).catch((e) => { console.log("gmail_accounts query failed:", e.message); return []; });
  console.log(JSON.stringify(gmailAccounts, null, 2));

  console.log("\n--- Pending status_change_approval action_items (for Approvals tab testing) ---");
  const pending = await query<any>(
    `SELECT ai.id, ai.candidate_id, c.name, ai.proposed_status, ai.proposed_from_status, ai.ai_confidence, ai.created_at
     FROM action_items ai JOIN candidates c ON c.id = ai.candidate_id
     WHERE ai.type = 'status_change_approval' AND ai.status = 'open' AND ai.decision IS NULL
     ORDER BY ai.created_at DESC LIMIT 5`
  ).catch((e) => { console.log("pending approvals query failed:", e.message); return []; });
  console.log(JSON.stringify(pending, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
