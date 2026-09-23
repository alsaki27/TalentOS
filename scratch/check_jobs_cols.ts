import { query } from "../src/server/db/neon";
async function main() {
  const cols = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs' ORDER BY column_name`
  );
  console.log(cols.map((c) => c.column_name).join(", "));
}
main();
