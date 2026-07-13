import { runJobLens } from "./src/lib/ai/application-agents/jobLens";
import { getProviderForAutomation } from "./src/lib/ai/routing";
async function main() {
  try {
    const provider = await getProviderForAutomation("application_job_lens");
    console.log("Resolved provider for job_lens:", provider?.name, provider?.model);
  } catch (err) {
    console.error("Error:", err);
  }
}
main();
