import { query } from "./src/server/db/neon";

async function main() {
  try {
    await query(`
      ALTER TABLE candidates 
      ADD COLUMN IF NOT EXISTS eeo_gender text,
      ADD COLUMN IF NOT EXISTS eeo_race text,
      ADD COLUMN IF NOT EXISTS eeo_veteran text,
      ADD COLUMN IF NOT EXISTS eeo_disability text;
    `);
    console.log("Success adding EEO fields");
    process.exit(0);
  } catch(e) {
    console.error("Error:", e);
    process.exit(1);
  }
}
main();
