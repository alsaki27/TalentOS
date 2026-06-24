const { neon } = require("@neondatabase/serverless");

// Test both pooled and direct connection strings.
// Set both in the environment before running - never hardcode them here.
const pooledUrl = process.env.DATABASE_URL_POOLED;
const directUrl = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!pooledUrl || !directUrl) {
  throw new Error("Set DATABASE_URL_POOLED and DATABASE_URL_DIRECT (or DATABASE_URL) in the environment before running this script.");
}

async function test() {
  for (const [name, url] of [["pooled", pooledUrl], ["direct", directUrl]]) {
    try {
      const sql = neon(url, { fetchOptions: { cache: "no-store" } });
      const result = await sql`SELECT NOW() as now, version() as version`;
      console.log(`✅ ${name} connection:`, result[0]);
    } catch (e) {
      console.error(`❌ ${name} connection failed:`, e.message?.substring(0, 200));
    }
  }
}

test().catch(e => console.error(e));
