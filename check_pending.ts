import * as fs from "fs";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { neon } from "@neondatabase/serverless";

async function run() {
  const sql = neon(process.env.DATABASE_URL!);
  const res = await sql`SELECT id, status, apify_run_id, created_at FROM job_agent_runs ORDER BY created_at DESC LIMIT 2`;
  console.log(res);
}

run().catch(console.error);
