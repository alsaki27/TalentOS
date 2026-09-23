import { neon } from "@neondatabase/serverless";
import * as fs from "fs";

async function run() {
  const env = fs.readFileSync(".env.local", "utf8");
  const dbUrl = env.split("\n").find(line => line.startsWith("DATABASE_URL="))?.split("=")[1]?.trim();
  const sql = neon(dbUrl!);
  
  console.log("Resetting failed jobs...");
  const result = await sql`
    UPDATE jobs 
    SET category_status = 'pending', job_category = NULL, ai_suggested_category = NULL 
    WHERE category_status = 'failed'
    RETURNING id
  `;
  console.log(`Reset ${result.length} jobs to pending status.`);
}

run().catch(console.error);
