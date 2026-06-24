async function run() {
  const { Pool } = await import('@neondatabase/serverless');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query("SELECT title, category_status, category_error FROM jobs ORDER BY created_at DESC LIMIT 10");
  console.table(rows);
  await pool.end();
}
run().catch(console.error);
