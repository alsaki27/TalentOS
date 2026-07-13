import { Client } from "@neondatabase/serverless";
import { readFileSync } from "fs";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const sql = readFileSync("migrations/job_agent_tokens_v2.sql", "utf-8");
const cleaned = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

const statements = cleaned.split(";").map((s) => s.trim()).filter((s) => s.length > 0);

async function main() {
  const c = new Client(url);
  await c.connect();
  let ok = 0, skip = 0;
  for (const s of statements) {
    try { await c.query(s); ok++; } 
    catch (e) { 
      if (e.message.includes("already exists") || e.message.includes("does not exist")) skip++; 
      else console.error("ERR:", e.message.slice(0, 100)); 
    }
  }
  console.log(`OK=${ok} SKIP=${skip}`);
  await c.end();
}
main().catch(e => { console.error(e); process.exit(1); });