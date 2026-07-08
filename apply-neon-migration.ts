import fs from "fs";
import { execute } from "./src/server/db/neon.ts";

async function applyMigration() {
  const sql = fs.readFileSync("neon/migrations/0002_job_match_scores.sql", "utf-8");
  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
  
  try {
    for (const stmt of statements) {
      await execute(stmt);
      console.log("Executed statement");
    }
    console.log("Migration applied successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
  }
}

applyMigration();
