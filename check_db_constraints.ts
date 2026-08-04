import { query } from "./src/server/db";

async function main() {
  const q1 = await query("SELECT conname, conrelid::regclass, confrelid::regclass, a.attname FROM pg_constraint c JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid WHERE confrelid = 'application_ai_workflows'::regclass");
  console.log(q1);
  process.exit(0);
}
main();
