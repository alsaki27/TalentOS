// scripts/audit-ai-automation-coverage.mjs
// Audits AI automation IDs across the codebase and compares against ai_automations.
// Usage: node scripts/audit-ai-automation-coverage.mjs

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { execSync } from "node:child_process";

const SRC_DIR = "src";
const ROUTING_FILE = join(SRC_DIR, "lib", "ai", "routing.ts");

const EXPECTED_SEEDED_AUTOMATIONS = new Set([
  "application_job_lens",
  "application_resume_forge",
  "application_hiring_panel",
  "application_final_polish",
  "resume_parsing",
  "candidate_markitdown",
  "jd_analysis",
  "job_categorization",
  "keyword_extraction",
  "evidence_mapping",
  "target_jobs_matching",
  "base_resume_studio",
  "application_tailoring",
  "resume_suggestions",
  "cover_letter_gen",
  "recruiter_message_gen",
  "ai_digest",
  "chat_assistant",
]);

function collectFiles(dir, extensions = [".ts", ".tsx"]) {
  const results = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
      results.push(...collectFiles(fullPath, extensions));
    } else if (entry.isFile() && extensions.includes(extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractAutomationIds(content) {
  const ids = new Set();
  const patterns = [
    /callWithUsageTracking\s*\(\s*"([^"]+)"\s*,/g,
    /callWithUsageTracking\s*\(\s*'([^']+)'\s*,/g,
    /getProviderForAutomation\s*\(\s*"([^"]+)"\s*/g,
    /getProviderForAutomation\s*\(\s*'([^']+)'\s*/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

function grepAutomationIds(dir) {
  const ids = new Set();
  try {
    const result = execSync(
      `rg --no-filename -o 'callWithUsageTracking\\s*\\(\\s*"[^"]+"' '${dir}' 2>$null || true`,
      { encoding: "utf-8", cwd: process.cwd(), shell: "powershell" }
    );
    for (const line of result.split("\n").filter(Boolean)) {
      const m = line.match(/"([^"]+)"/);
      if (m) ids.add(m[1]);
    }
  } catch {}
  try {
    const result = execSync(
      `rg --no-filename -o 'getProviderForAutomation\\s*\\(\\s*"[^"]+"' '${dir}' 2>$null || true`,
      { encoding: "utf-8", cwd: process.cwd(), shell: "powershell" }
    );
    for (const line of result.split("\n").filter(Boolean)) {
      const m = line.match(/"([^"]+)"/);
      if (m) ids.add(m[1]);
    }
  } catch {}
  return ids;
}

console.log("=== AI Automation Coverage Audit ===\n");

// 1. Extract from routing.ts
console.log("--- Step 1: Extract automation IDs from routing.ts ---");
if (existsSync(ROUTING_FILE)) {
  const content = readFileSync(ROUTING_FILE, "utf-8");
  const routingIds = extractAutomationIds(content);
  console.log(`Found ${routingIds.size} automation IDs in routing.ts:`);
  for (const id of [...routingIds].sort()) {
    console.log(`  ${id}`);
  }
} else {
  console.log(`WARNING: routing.ts not found at ${ROUTING_FILE}`);
}

// 2. Grep all TypeScript files in src/
console.log("\n--- Step 2: Grep all callWithUsageTracking/getProviderForAutomation call sites ---");
const grepIds = grepAutomationIds(SRC_DIR);
console.log(`Found ${grepIds.size} automation IDs in codebase:`);
for (const id of [...grepIds].sort()) {
  console.log(`  ${id}`);
}

// 3. Compare against known seed
console.log("\n--- Step 3: Compare against expected ai_automations seed ---");
console.log(`Expected seeded automations: ${EXPECTED_SEEDED_AUTOMATIONS.size}`);
console.log(`Codebase automations: ${grepIds.size}`);

const missingFromSeed = [];
const missingFromCode = [];

for (const id of grepIds) {
  if (!EXPECTED_SEEDED_AUTOMATIONS.has(id)) {
    missingFromSeed.push(id);
  }
}

for (const id of EXPECTED_SEEDED_AUTOMATIONS) {
  if (!grepIds.has(id)) {
    missingFromCode.push(id);
  }
}

console.log("\n--- Report ---");
if (missingFromSeed.length === 0 && missingFromCode.length === 0) {
  console.log("PASS: All automation IDs are consistent between codebase and ai_automations seed.");
} else {
  if (missingFromSeed.length > 0) {
    console.log(`MISSING FROM SEED (${missingFromSeed.length}): These are used in code but not in ai_automations:`);
    for (const id of missingFromSeed.sort()) {
      console.log(`  ${id}`);
    }
  }
  if (missingFromCode.length > 0) {
    console.log(`NOT IN CODEBASE (${missingFromCode.length}): These are in ai_automations but not found in code:`);
    for (const id of missingFromCode.sort()) {
      console.log(`  ${id}`);
    }
  }
}

// 4. Also check for duplicates
console.log("\n--- Step 4: Duplicate check ---");
const seen = new Set();
let duplicates = false;
for (const id of [...grepIds].sort()) {
  if (seen.has(id)) {
    console.log(`DUPLICATE: ${id}`);
    duplicates = true;
  }
  seen.add(id);
}
if (!duplicates) console.log("No duplicates found.");

// Exit code for CI
const hasIssues = missingFromSeed.length > 0 || missingFromCode.length > 0 || duplicates;
process.exit(hasIssues ? 1 : 0);
