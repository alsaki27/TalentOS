import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
async function main() {
  const cols = await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns WHERE table_name = 'activity_logs' ORDER BY ordinal_position
  `;
  console.table(cols);
  const sample = await sql`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 3`;
  console.log(JSON.stringify(sample, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
