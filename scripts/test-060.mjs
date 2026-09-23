import { Client } from "@neondatabase/serverless";
import { readFileSync } from "fs";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

async function main() {
  const content = readFileSync("sql/neon_fixes/060_seed_avirup_resume_search_profiles.sql", "utf-8");
  const client = new Client(url);
  await client.connect();
  try {
    await client.query(content);
    console.log("Success");
  } catch (e) {
    console.error("Error:", e.message);
  }
  await client.end();
}
main();
