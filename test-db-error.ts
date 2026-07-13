import { neon } from '@neondatabase/serverless';
const sql = neon("postgresql://neondb_owner:npg_Gj1bqgAwf0mE@ep-withered-leaf-at0ubn6s-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require");
async function check() {
  const rows = await sql`SELECT last_error FROM application_ai_workflows WHERE status = 'failed' ORDER BY created_at DESC LIMIT 1`;
  console.log(rows[0]?.last_error);
}
check();
