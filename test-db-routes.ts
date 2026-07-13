import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function main() {
  try {
    const res = await pool.query("SELECT * FROM ai_automation_routes WHERE automation_id = 'resume_parsing'");
    console.log("Routes:", res.rows);
    const keys = await pool.query("SELECT id, provider, model, is_enabled FROM ai_api_keys");
    console.log("Keys:", keys.rows);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    pool.end();
  }
}
main();
