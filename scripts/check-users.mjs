import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();
const r = await c.query("SELECT user_id, email, display_name, role FROM profiles ORDER BY created_at LIMIT 10");
for (const row of r.rows) console.log(`${row.email ?? "(no email)"} | role=${row.role} | name=${row.display_name ?? "-"} | id=${row.user_id}`);
await c.end();
