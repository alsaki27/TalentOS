import fs from "fs";
import { execute } from "./src/server/db/neon";

async function applyMigration() {
  const sql = fs.readFileSync("migrations/job_hunter_runs.sql", "utf-8");
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
