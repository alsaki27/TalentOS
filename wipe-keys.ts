import { execute } from "./src/server/db/neon";

async function main() {
    console.log("Wiping corrupted keys from ai_api_keys...");
    try {
        await execute("DELETE FROM ai_api_keys");
        console.log("Keys successfully deleted!");
    } catch (e) {
        console.error("Failed to delete keys:", e);
    }
}
main();
