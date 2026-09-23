import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "fs";

function loadEnv() {
  if (!existsSync(".env.local")) return;
  const content = readFileSync(".env.local", "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      process.env[key] = val;
    }
  }
}
loadEnv();

const sql = neon(process.env.DATABASE_URL);

async function run() {
  try {
    const runs = await sql(`SELECT * FROM job_ceo_runs ORDER BY created_at DESC LIMIT 5`);
    console.log("RUNS:", JSON.stringify(runs, null, 2));
    
    if (runs.length > 0) {
       const staged = await sql(`SELECT stage, COUNT(*) FROM job_ceo_staging WHERE run_id = '${runs[0].id}' GROUP BY stage`);
       console.log("STAGED FOR LATEST RUN:", JSON.stringify(staged, null, 2));
    }
  } catch (err) {
    console.error(err);
  }
}
run();
