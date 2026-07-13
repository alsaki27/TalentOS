import { query } from "./src/server/db/neon";

async function main() {
    try {
        const automations = await query("SELECT * FROM ai_automations");
        console.log("Automations count:", automations.length);
        const routes = await query(`
            SELECT ar.*, ak.label as key_label 
            FROM ai_automation_routes ar
            LEFT JOIN ai_api_keys ak ON ar.ai_key_id = ak.id
        `);
        console.log("Routes count:", routes.length);
        console.log("Sample route:", routes[0]);
    } catch (e) {
        console.error("Error:", e);
    }
}
main();
