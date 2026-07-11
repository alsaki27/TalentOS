import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();
const r = await c.query(
  "SELECT column_name FROM information_schema.columns WHERE table_name = 'applications' ORDER BY ordinal_position"
);
for (const row of r.rows) console.log(row.column_name);
await c.end();
