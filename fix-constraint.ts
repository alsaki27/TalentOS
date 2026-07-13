import { execute } from "./src/server/db/neon";

async function main() {
    console.log("Dropping check constraint on ai_api_keys...");
    try {
        await execute("ALTER TABLE ai_api_keys DROP CONSTRAINT IF EXISTS ai_api_keys_status_check");
        console.log("Constraint successfully dropped!");
    } catch (e) {
        console.error("Failed to drop constraint:", e);
    }
}
main();
