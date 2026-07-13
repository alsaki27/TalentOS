import { query } from "./src/server/db/neon";

async function main() {
    try {
        const automations = await query("SELECT * FROM ai_automations");
        const automationIds = automations.map(a => a.id);
        const routes = await query(
            `SELECT ar.automation_id, ar.id, ar.ai_key_id, ar.provider, ar.rank, ar.is_enabled,
                    ar.model_override, ar.updated_at, ar.updated_by, ar.created_at,
                    ak.label as key_label, ak.provider as key_provider,
                    ak.model as key_model, ak.key_fingerprint,
                    ak.status as key_status
             FROM ai_automation_routes ar
             LEFT JOIN ai_api_keys ak ON ar.ai_key_id = ak.id
             WHERE ar.automation_id = ANY($1)
             ORDER BY ar.automation_id, ar.rank`,
            [automationIds]
        );
        console.log("Query executed successfully, routes:", routes.length);
    } catch (e) {
        console.error("Query failed:", e);
    }
}
main();
