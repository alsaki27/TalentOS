import { getProviderForAutomation } from "./src/lib/ai/routing";
async function main() {
  try {
    const p = await getProviderForAutomation("resume_parsing");
    console.log("Provider:", p?.name, p?.model);
  } catch (err) {
    console.error("Error:", err);
  }
}
main();
