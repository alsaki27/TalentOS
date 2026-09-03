import { execute } from "../src/server/db/neon";
import * as fs from "fs";
async function main() {
  const sql = fs.readFileSync("sql/neon_fixes/093_job_analysis_cache.sql", "utf8");
  const statements = sql.split(";").map(s => s.trim()).filter(s => s && !s.startsWith("--"));
  for (const stmt of statements) {
    console.log("Running:", stmt.slice(0, 80));
    await execute(stmt);
  }
  console.log("Migration 093 applied successfully.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
