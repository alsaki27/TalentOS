import { execute } from "../src/server/db/neon";
async function main() {
  await execute("DELETE FROM action_items WHERE id = $1", ["e9703e78-21bb-46f3-ba6c-29a3c3d9e1db"]);
  console.log("Deleted test handover action item.");
}
main().catch((e) => { console.error(e); process.exit(1); });
