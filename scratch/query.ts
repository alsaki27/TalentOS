import { query } from "../src/server/db.ts";

async function main() {
  try {
    const result = await query("SELECT candidates.name FROM applications JOIN candidates ON applications.candidate_id = candidates.id WHERE applications.app_number = 10061");
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

main();
