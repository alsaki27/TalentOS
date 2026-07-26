import { config } from "dotenv";
config({ path: ".env.local" });

import { getGoogleVertexProxyProvider } from "./src/lib/ai/googleVertexProxyProvider.ts";
import { extractProfessionalSkills } from "./src/lib/ai/source-of-truth/extractProfessionalSkills.ts";
import { query } from "./src/server/db/neon.ts";

async function run() {
  const candidateId = "c_93d6cdb7147b4d1b"; // Need a real candidate ID to test. I will query for one.
  const baseResumes = await query("SELECT * FROM base_resumes LIMIT 1", []);
  if (baseResumes.length === 0) {
    console.log("No base resumes found.");
    return;
  }
  const resume = baseResumes[0];
  console.log("Testing with resume:", resume.id);
  
  const contents = [resume.content].filter(c => c && typeof c === "object");
  const provider = getGoogleVertexProxyProvider("gemini-2.5-pro");
  if (!provider) {
    console.log("No provider");
    return;
  }
  
  try {
    const extractedSkills = await extractProfessionalSkills(contents, provider);
    console.log("Extracted skills:", extractedSkills);
  } catch (err) {
    console.error("Error during extraction:", err);
  }
}

run();
