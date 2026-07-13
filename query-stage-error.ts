import { query } from "./src/server/db/neon";
async function main() {
  try {
    const res = await query("SELECT * FROM application_ai_stage_runs ORDER BY id DESC LIMIT 5");
    console.log("Stage Runs:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}
main();
