import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon('postgresql://neondb_owner:npg_Gj1bqgAwf0mE@ep-withered-leaf-at0ubn6s-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require');
  const result = await sql`SELECT count(*) FROM candidates WHERE status = 'active'`;
  console.log('Active Candidates:', result[0].count);
}
main().catch(console.error);
