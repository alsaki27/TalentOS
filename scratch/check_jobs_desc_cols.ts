import { query } from "../src/server/db/neon";
async function main() {
  const cols = await query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'jobs' AND column_name ILIKE '%desc%'`
  );
  console.log(cols);
}
main();
