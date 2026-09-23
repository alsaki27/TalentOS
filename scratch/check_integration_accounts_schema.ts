// READ-ONLY. npx tsx --env-file=.env.local scratch/check_integration_accounts_schema.ts
import { query } from "../src/server/db/neon";

async function main() {
  const cols = await query<{ column_name: string; data_type: string }>(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'integration_accounts' ORDER BY ordinal_position"
  );
  console.log("integration_accounts columns:", JSON.stringify(cols, null, 2));

  const rows = await query<any>(
    "SELECT * FROM integration_accounts WHERE provider = 'gmail' AND owner_type = 'candidate' ORDER BY updated_at DESC LIMIT 5"
  );
  console.log("\nSample rows (secrets redacted manually if present):", JSON.stringify(rows.map((r: any) => ({ ...r, access_token: r.access_token ? "[redacted]" : null, refresh_token: r.refresh_token ? "[redacted]" : null })), null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
