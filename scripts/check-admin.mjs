import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();
const r = await c.query(
  "SELECT email, role, display_name, password_hash IS NOT NULL as has_hash FROM profiles WHERE email LIKE $1",
  ["%admin%"]
);
for (const row of r.rows) console.log(`${row.email} | role=${row.role} | name=${row.display_name || "-"} | hash=${row.has_hash}`);
await c.end();
