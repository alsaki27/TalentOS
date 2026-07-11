import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();
// Get the check constraint definition
const r = await c.query(`
  SELECT conname, pg_get_constraintdef(oid) as def
  FROM pg_constraint
  WHERE conrelid = 'application_resume_versions'::regclass AND contype = 'c'
`);
for (const row of r.rows) console.log(row.conname, ":", row.def);

// Also show enum values if it uses an enum
const enumTypes = await c.query(`
  SELECT t.typname, e.enumlabel
  FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
  WHERE t.typname LIKE '%source%' OR t.typname LIKE '%resume%'
  ORDER BY t.typname, e.enumsortorder
`);
if (enumTypes.rows.length > 0) {
  console.log("\nEnum values:");
  for (const row of enumTypes.rows) console.log(`  ${row.typname}: ${row.enumlabel}`);
}
await c.end();
