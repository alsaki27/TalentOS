import 'dotenv/config';
import { processPendingCategorization } from "./src/lib/ai/jobCategorization";

async function run() {
  const result = await processPendingCategorization({ limit: 1 });
  console.log("Result:", result);
}
run().catch(console.error);
