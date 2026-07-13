import { neon } from '@neondatabase/serverless';
const sql = neon("postgresql://neondb_owner:npg_Gj1bqgAwf0mE@ep-withered-leaf-at0ubn6s-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require");
async function check() {
  const rows = await sql`SELECT data FROM application_ai_artifacts WHERE automation_id = 'application_final_polish' ORDER BY created_at DESC LIMIT 1`;
  console.log(JSON.stringify(rows[0]?.data?.exportReady));
  console.log(JSON.stringify(rows[0]?.data?.unresolvedWarnings));
}
check();
