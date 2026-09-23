import { neon } from '@neondatabase/serverless';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const sql = neon(databaseUrl);
  const result = await sql`SELECT count(*) FROM candidates WHERE status = 'active'`;
  console.log('Active Candidates:', result[0].count);
}
main().catch(console.error);
