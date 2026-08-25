// READ-ONLY. npx tsx --env-file=.env.local scratch/check_profiles_schema.ts
import { query } from "../src/server/db/neon";

async function main() {
  const cols = await query<{ column_name: string; data_type: string; is_nullable: string }>(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'profiles' ORDER BY ordinal_position"
  );
  console.log("profiles columns:", JSON.stringify(cols, null, 2));

  const roles = await query<{ role: string; count: string }>(
    "SELECT role, COUNT(*) as count FROM profiles GROUP BY role"
  );
  console.log("\nDistinct roles in use:", JSON.stringify(roles, null, 2));

  const sample = await query<any>("SELECT user_id, email, role, display_name FROM profiles LIMIT 3");
  console.log("\nSample profiles:", JSON.stringify(sample, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
