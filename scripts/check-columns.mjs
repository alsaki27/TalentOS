import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();
const r = await c.query(
  "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'ai_api_keys' ORDER BY ordinal_position"
);
for (const row of r.rows) console.log(row.column_name, row.data_type);
await c.end();
