import { execute } from "../src/server/db/neon";
async function main() {
  await execute("DELETE FROM falood_saved_applications WHERE id = $1", ["d52b3d65-2ef6-47d9-b597-f8796869d069"]);
  console.log("Deleted test session.");
}
main();
