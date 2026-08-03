import { fetchJobPageText } from "./src/lib/ai/job-agents/fetchJobPage";

async function run() {
  const testUrl = "https://boards.greenhouse.io/openai/jobs/5233261003"; // Known JS-heavy ATS page
  console.log(`Starting deep fetch for: ${testUrl}`);
  const startTime = Date.now();
  
  const text = await fetchJobPageText(testUrl);
  
  const duration = (Date.now() - startTime) / 1000;
  console.log(`\nFetch completed in ${duration} seconds.`);
  console.log(`Extracted text length: ${text.length} characters.`);
  if (text.length > 500) {
    console.log(`Preview:\n${text.substring(0, 500)}...`);
  } else {
    console.log(`Content:\n${text}`);
  }
}

run().catch(console.error);
