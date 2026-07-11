// End-to-end test of the multi-agent pipeline against a real application.
// Tests provider connectivity, agent output validation, and workflow creation.
//
// Usage:
//   DATABASE_URL=... PROVIDER=anthropic API_KEY=sk-ant-... node scripts/test-pipeline-e2e.mjs

import { Client } from "@neondatabase/serverless";
import { neon } from "@neondatabase/serverless";

const DB_URL = process.env.DATABASE_URL;
const PROVIDER = process.env.PROVIDER || "anthropic";
const API_KEY = process.env.API_KEY;

if (!DB_URL) { console.error("DATABASE_URL required"); process.exit(1); }
if (!API_KEY) { console.error("API_KEY required — set PROVIDER and API_KEY env vars"); process.exit(1); }

console.log(`\n=== PIPELINE TEST ===`);
console.log(`Provider: ${PROVIDER}`);
console.log(`DB: connected\n`);

// ── Step 1: Test provider connectivity ──
async function testProvider() {
  console.log("--- Step 1: Provider connectivity ---");

  const messages = [
    { role: "user" as const, content: [{ type: "text" as const, text: "Reply with exactly: OK_PROVIDER_TEST" }] },
  ];

  let provider;
  if (PROVIDER === "anthropic") {
    const { AnthropicProvider } = await import("@/lib/ai/providers/anthropic");
    provider = new AnthropicProvider(API_KEY);
  } else if (PROVIDER === "google" || PROVIDER === "google_vertex_proxy") {
    const { GoogleVertexProvider } = await import("@/lib/ai/providers/googleVertex");
    provider = new GoogleVertexProvider(API_KEY);
  } else {
    // Try generic OpenAI-compatible
    const { OpenAICompatibleProvider } = await import("@/lib/ai/providers/openai");
    provider = new OpenAICompatibleProvider(PROVIDER, API_KEY);
  }

  try {
    const response = await provider.send({
      system: "You are a test bot.",
      messages,
      tools: [],
    });
    const text = response.content?.map((c: any) => c.text).join("") || "(empty)";
    console.log(`  ✓ Response: ${text.slice(0, 100)}`);
    return true;
  } catch (err) {
    console.error(`  ✗ Provider error: ${err.message}`);
    return false;
  }
}

// ── Step 2: Load application data ──
async function loadApplication() {
  console.log("\n--- Step 2: Load application data ---");

  const client = new Client(DB_URL);
  await client.connect();

  // Get the most recent application
  const app = (await client.query(`
    SELECT a.id, a.candidate_id, a.job_id, a.status,
           j.title as job_title, j.description as job_desc,
           j.raw_description, j.company, j.location
    FROM applications a
    LEFT JOIN jobs j ON a.job_id = j.id
    ORDER BY a.created_at DESC LIMIT 1
  `)).rows[0];

  if (!app) { console.log("  No applications found"); await client.end(); return null; }

  console.log(`  Application: ${app.id}`);
  console.log(`  Candidate: ${app.candidate_id}`);
  console.log(`  Job: ${app.job_title || app.job_id}`);

  // Get candidate data
  const cand = (await client.query(`
    SELECT id, name, email, parsed_json FROM candidates WHERE id = $1
  `, [app.candidate_id])).rows[0];
  console.log(`  Candidate: ${cand?.name || cand?.email || "unnamed"}`);

  // Get base resume
  const resume = (await client.query(`
    SELECT id, content FROM application_resume_versions
    WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1
  `, [app.id])).rows[0];
  console.log(`  Resume version: ${resume?.id || "none"}`);

  // Get evidence
  const evidence = (await client.query(`
    SELECT id, title, description, related_skills, confidence_score, source
    FROM candidate_evidence WHERE candidate_id = $1 LIMIT 20
  `, [app.candidate_id])).rows;
  console.log(`  Evidence items: ${evidence.length}`);

  await client.end();

  return { application: app, candidate: cand, resume, evidence };
}

// ── Step 3: Simulate Job Lens agent call ──
async function testJobLens(appData) {
  console.log("\n--- Step 3: Job Lens agent ---");

  if (!appData) { console.log("  Skipped — no application data"); return null; }

  const jobDescription = appData.application.job_desc || appData.application.raw_description || "No description available";

  const prompt = {
    system: "You are Job Lens. Analyze this job posting and return structured analysis as JSON with: title, company, location, requiredSkills, preferredSkills, tools, methodologies, certifications, seniority, domain, atsKeywords, responsibilities, evidenceRequirements, prohibitedUnsupportedClaims, ambiguities, rawSummary.",
    messages: [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: `Job: ${appData.application.job_title || "Unknown"}\nCompany: ${appData.application.company || "Unknown"}\nLocation: ${appData.application.location || "Not specified"}\n\nDescription:\n${jobDescription.slice(0, 6000)}\n\nReturn ONLY valid JSON.`,
          },
        ],
      },
    ],
    tools: [],
  };

  // Build provider
  let provider;
  if (PROVIDER === "anthropic") {
    const { AnthropicProvider } = await import("@/lib/ai/providers/anthropic");
    provider = new AnthropicProvider(API_KEY);
  } else {
    const { OpenAICompatibleProvider } = await import("@/lib/ai/providers/openai");
    provider = new OpenAICompatibleProvider(PROVIDER, API_KEY);
  }

  try {
    const response = await provider.send(prompt);
    const raw = response.content?.map((c: any) => c.text).join("") || "";
    const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

    // Validate against schema
    const { JobAnalysisSchema } = await import("@/lib/ai/application-agents/schemas");
    const parsed = JSON.parse(stripped);
    const validated = JobAnalysisSchema.parse(parsed);

    if ("error" in validated) {
      console.log(`  ✗ Schema validation failed: ${validated.error}`);
      return null;
    }

    console.log(`  ✓ Title: ${validated.title}`);
    console.log(`  ✓ Required skills: ${validated.requiredSkills.length}`);
    console.log(`  ✓ Preferred skills: ${validated.preferredSkills.length}`);
    console.log(`  ✓ ATS keywords: ${validated.atsKeywords.length}`);
    console.log(`  ✓ Seniority: ${validated.seniority}`);
    return validated;
  } catch (err) {
    console.error(`  ✗ Agent error: ${err.message}`);
    return null;
  }
}

// ── Step 4: Test workflow creation in DB ──
async function testWorkflowCreation(appData) {
  console.log("\n--- Step 4: Workflow creation and persistence ---");

  if (!appData) { console.log("  Skipped — no application data"); return null; }

  const { createWorkflow, findWorkflowById, updateWorkflowStatus, createStageRun } =
    await import("@/server/repositories/applicationAiWorkflowRepository");

  // Create a workflow
  const wf = await createWorkflow({
    applicationId: appData.application.id,
    baseResumeId: appData.resume?.id,
    idempotencyKey: `test-e2e-${Date.now()}`,
  });
  console.log(`  ✓ Workflow created: ${wf.id} (status: ${wf.status})`);

  // Create a stage run
  const stage = await createStageRun({
    workflowId: wf.id,
    automationId: "application_job_lens",
    sequenceNumber: 1,
  });
  console.log(`  ✓ Stage run created: ${stage.id} (status: ${stage.status})`);

  // Update to success
  await updateWorkflowStatus(wf.id, "completed");
  const updated = await findWorkflowById(wf.id);
  console.log(`  ✓ Workflow completed: ${updated.status}`);

  return wf;
}

// ── Main ──
async function main() {
  const providerOk = await testProvider();
  if (!providerOk) {
    console.error("\n✗ Provider connectivity failed — check API key and provider name.");
    console.log("  Usage: PROVIDER=anthropic API_KEY=sk-ant-... node scripts/test-pipeline-e2e.mjs");
    console.log("  Or:    PROVIDER=google API_KEY=... node scripts/test-pipeline-e2e.mjs");
    process.exit(1);
  }

  const appData = await loadApplication();
  const jobLensOutput = await testJobLens(appData);
  const workflowResult = await testWorkflowCreation(appData);

  console.log("\n=== RESULTS ===");
  console.log(`Provider connectivity:  ${providerOk ? "✓" : "✗"}`);
  console.log(`Job Lens agent:        ${jobLensOutput ? "✓" : "✗"}`);
  console.log(`Workflow persistence:  ${workflowResult ? "✓" : "✗"}`);
  console.log(`Usage event recording: pending (needs real app server)`);

  if (jobLensOutput) {
    console.log(`\nRequired skills: ${jobLensOutput.requiredSkills.join(", ")}`);
    console.log(`ATS keywords: ${jobLensOutput.atsKeywords.join(", ")}`);
  }
}

main().catch(e => { console.error(`Fatal: ${e.message}`); process.exit(1); });
