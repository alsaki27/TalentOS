import { execute } from "../src/server/db/neon";
async function main() {
  await execute("DELETE FROM falood_saved_applications WHERE id = $1", ["97cd3258-58b5-42b4-a0bd-9387c8e6d413"]);
  console.log("Deleted test row.");
}
main();
