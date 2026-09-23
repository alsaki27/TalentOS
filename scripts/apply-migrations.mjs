// Apply all migration SQL files as multi-statement batches
import { Client } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";


const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const migrations = process.argv.slice(2).map(arg => resolve(process.cwd(), arg));
if (migrations.length === 0) {
  console.error("Please provide at least one SQL file to run.");
  process.exit(1);
}

// Split SQL into individual statements, respecting string literals and dollar-quotes
function splitSql(sql) {
  const stmts = [];
  let current = "";
  let inSingleQuote = false;
  let inDollar = false;
  let dollarTag = "";

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1] || "";

    if (!inSingleQuote && !inDollar && ch === "$" && /[a-zA-Z_]/.test(next)) {
      // Start of dollar-quote
      let tag = "";
      let j = i + 1;
      while (j < sql.length && /[a-zA-Z0-9_]/.test(sql[j])) { tag += sql[j]; j++; }
      if (sql[j] === "$") {
        inDollar = true;
        dollarTag = tag;
        current += sql.slice(i, j + 1);
        i = j;
        continue;
      }
    }

    if (inDollar && ch === "$") {
      // Check if this ends the dollar-quote
      let j = i + 1;
      let endTag = "";
      while (j < sql.length && /[a-zA-Z0-9_]/.test(sql[j])) { endTag += sql[j]; j++; }
      if (endTag === dollarTag && sql[j] === "$") {
        inDollar = false;
        dollarTag = "";
        current += sql.slice(i, j + 1);
        i = j;
        continue;
      }
    }

    if (!inDollar) {
      if (ch === "'" && !inSingleQuote) { inSingleQuote = true; }
      else if (ch === "'" && inSingleQuote) {
        // Check for escaped quote
        if (next === "'") { current += "''"; i++; }
        else { inSingleQuote = false; }
      }
    }

    if (ch === ";" && !inSingleQuote && !inDollar) {
      if (current.trim()) stmts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) stmts.push(current.trim());
  return stmts;
}

async function main() {
  for (const file of migrations) {
    const content = readFileSync(file, "utf-8");
    const statements = splitSql(content);

    const client = new Client(url);
    await client.connect();

    let executed = 0;
    for (const stmt of statements) {
      // Skip comment-only lines
      if (stmt.replace(/^--.*$/gm, "").trim().length === 0) continue;
      try {
        await client.query(stmt);
        executed++;
      } catch (e) {
        if (e.message?.includes("already exists") || e.message?.includes("duplicate key")) {
          // idempotent — skip silently
        } else if (e.message?.includes("syntax error at or near")) {
          console.error(`  [SQL ERR] ${e.message.slice(0, 120)}`);
        } else {
          console.error(`  [SQL ERR] ${e.message.slice(0, 120)}`);
        }
      }
    }
    console.log(`${file}: ${executed}/${statements.length} statements executed`);
    await client.end();
  }

  // Verify
  console.log("\nVerifying new tables...");
  const vclient = new Client(url);
  await vclient.connect();
  const names = ['ai_automations', 'ai_automation_routes', 'ai_usage_events', 'ai_usage_daily', 'ai_agent_configs', 'application_ai_workflows', 'application_ai_stage_runs', 'application_ai_artifacts'];
  for (const name of names) {
    const res = await vclient.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)`, [name]);
    console.log(`  ${name}: ${res.rows[0].exists ? '✓' : '✗'}`);
  }
  await vclient.end();
}

main().catch(e => { console.error("Migration failed:", e.message); process.exit(1); });
