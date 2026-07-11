import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();
const r = await c.query(
  "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'target_jobs' ORDER BY ordinal_position"
);
for (const row of r.rows) console.log(`${row.column_name} ${row.data_type} nullable=${row.is_nullable}`);
await c.end();
