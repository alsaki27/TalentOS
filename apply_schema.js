const { neon } = require("@neondatabase/serverless");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL in the environment before running this script.");
const sql = neon(url, { fetchOptions: { cache: "no-store" } });

const fs = require("fs");
let schema = fs.readFileSync("neon/migrations/0001_initial_schema.sql", "utf8");

// Remove SQL comments first
schema = schema.replace(/\/\*[\s\S]*?\*\//g, '');  // /* ... */
schema = schema.replace(/^\s*--.*$/gm, '');          // -- ...
schema = schema.replace(/^\s*$/gm, '');             // empty lines

async function apply() {
  const statements = schema
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  console.log("Total statements:", statements.length);
  console.log("First 5:", statements.slice(0, 5).map(s => s.substring(0, 70)));
  
  let ok = 0, skip = 0, err = 0;
  for (const stmt of statements) {
    const fullStmt = stmt + ";";
    try {
      await sql.query(fullStmt);
      ok++;
    } catch (e) {
      const msg = (e.message || "").toLowerCase();
      if (msg.includes("already exists") || msg.includes("duplicate")) {
        skip++;
      } else {
        err++;
        console.error("ERR:", e.message?.substring(0, 120));
        console.error("  STMT:", fullStmt.substring(0, 100).replace(/\n/g, " "));
      }
    }
  }
  
  console.log(`\nResults: OK=${ok}, SKIP=${skip}, ERR=${err}`);
  
  const result = await sql.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;");
  console.log("Tables:", result.length);
  result.forEach(r => console.log("  -", r.tablename));
  
  const idx = await sql.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname;");
  console.log("Indexes:", idx.length);
}

apply().catch(e => { console.error(e); process.exit(1); });
