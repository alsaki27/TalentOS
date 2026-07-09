// @ts-ignore
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { execute } from "../src/server/db/neon";
import * as fs from "fs";
import * as path from "path";

async function run() {
  const sqlFile = path.join(__dirname, "../neon/migrations/0003_ats_score_evaluations.sql");
  const sql = fs.readFileSync(sqlFile, "utf-8");
  console.log("Running migration...");
  await execute(sql);
  console.log("Migration complete!");
}

run().catch(console.error);
