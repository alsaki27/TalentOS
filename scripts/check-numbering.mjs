import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();

// Check existing numbering
const cols1 = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'applications' ORDER BY ordinal_position");
console.log("applications:", cols1.rows.map(r=>r.column_name).join(", "));

const cols2 = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'candidates' ORDER BY ordinal_position");
console.log("candidates:", cols2.rows.map(r=>r.column_name).join(", "));

const cols3 = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs' ORDER BY ordinal_position");
console.log("jobs:", cols3.rows.map(r=>r.column_name).join(", "));

await c.end();
