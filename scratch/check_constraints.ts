import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
async function main() {
  const cons = await sql`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint WHERE conrelid = 'activity_logs'::regclass
  `;
  console.table(cons);
  const distinctTypes = await sql`SELECT DISTINCT type FROM activity_logs ORDER BY 1`;
  console.log("distinct types:", distinctTypes.map((r:any)=>r.type));
  const distinctActorTypes = await sql`SELECT DISTINCT actor_type FROM activity_logs ORDER BY 1`;
  console.log("distinct actor_types:", distinctActorTypes.map((r:any)=>r.actor_type));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
