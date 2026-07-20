import fs from "fs";
import { neon } from "@neondatabase/serverless";

const envContent = fs.readFileSync(".env.local", "utf8");
const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/);
if (!dbUrlMatch) throw new Error("No DATABASE_URL in .env.local");

const sql = neon(dbUrlMatch[1].trim().replace(/^"|"$/g, ""));

async function main() {
  console.log("Deleting corrupted AI keys from database...");
  await sql`DELETE FROM ai_api_keys;`;
  console.log("Done. The system will now fallback to OPENAI_API_KEY from .env.local");
}

main().catch(console.error);
