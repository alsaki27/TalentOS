import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const EXPECTED_WORKER = "skarion-talent-os";
const EXPECTED_BRANCH = "neon-cloudflare-migration";
const EXPECTED_HYPERDRIVE_ID = "30402bc671364a7686899a2bec4befb1";
const errors = [];

function read(relativePath) {
  const absolutePath = join(ROOT, relativePath);
  if (!existsSync(absolutePath)) {
    errors.push(`${relativePath} is missing`);
    return "";
  }
  return readFileSync(absolutePath, "utf8");
}

function requireMatch(value, pattern, message) {
  if (!pattern.test(value)) errors.push(message);
}

function currentBranch() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && existsSync(eventPath)) {
    try {
      const event = JSON.parse(readFileSync(eventPath, "utf8"));
      const eventBranch = event.workflow_run?.head_branch ?? event.pull_request?.base?.ref;
      if (eventBranch) return eventBranch;
    } catch {
      // Fall through to the normal GitHub environment variables.
    }
  }

  return (
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME ||
    execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim()
  );
}

function isPlaceholder(value) {
  const normalized = value.toLowerCase();
  return (
    normalized === "password" ||
    normalized === "secret" ||
    normalized === "user" ||
    normalized === "..." ||
    normalized.includes("changeme") ||
    normalized.includes("replace") ||
    normalized.includes("your_") ||
    normalized.includes("<") ||
    normalized.includes(">")
  );
}

function scanTrackedCredentialUris() {
  let output;
  try {
    output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  } catch (error) {
    errors.push(`Could not list tracked files: ${error.message}`);
    return;
  }

  const trackedFiles = output.split("\0").filter(Boolean);
  const credentialUri = /(?:postgres(?:ql)?|mysql(?:\+[^:]+)?):\/\/[^/\s:@]+:([^@\s]+)@/gi;

  for (const file of trackedFiles) {
    const absolutePath = join(ROOT, file);
    if (!existsSync(absolutePath)) continue;

    const content = readFileSync(absolutePath);
    if (content.includes(0)) continue;

    const lines = content.toString("utf8").split(/\r?\n/);
    for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
      credentialUri.lastIndex = 0;
      for (const match of lines[lineNumber].matchAll(credentialUri)) {
        if (!isPlaceholder(match[1])) {
          errors.push(`${file}:${lineNumber + 1} contains a credential-bearing database URI`);
        }
      }
    }
  }
}

const wrangler = read("wrangler.toml");
const workerEntry = read("worker-entry.mjs");
const deployWorkflow = read(".github/workflows/deploy.yml");
const packageJsonText = read("package.json");
read("scripts/verify-cloudflare-live-deployment.mjs");

requireMatch(wrangler, /^name\s*=\s*"skarion-talent-os"\s*$/m, `Worker name must be ${EXPECTED_WORKER}`);
requireMatch(wrangler, /^main\s*=\s*"worker-entry\.mjs"\s*$/m, "Worker entrypoint must be worker-entry.mjs");
requireMatch(wrangler, /assets\s*=\s*\{[^\n]*directory\s*=\s*"\.open-next\/assets"/, "Worker assets must come from the current OpenNext output");
requireMatch(workerEntry, /from\s+["']\.\/\.open-next\/worker\.js["']/, "Worker entrypoint must wrap the current OpenNext output");

const hyperdriveBlocks = [...wrangler.matchAll(/^\[\[hyperdrive\]\]\s*$/gm)];
if (hyperdriveBlocks.length !== 1) {
  errors.push(`Expected exactly one active [[hyperdrive]] block, found ${hyperdriveBlocks.length}`);
} else {
  const blockStart = hyperdriveBlocks[0].index + hyperdriveBlocks[0][0].length;
  const remainder = wrangler.slice(blockStart);
  const nextSection = remainder.search(/^\[/m);
  const block = nextSection === -1 ? remainder : remainder.slice(0, nextSection);
  const binding = block.match(/^binding\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const id = block.match(/^id\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (binding !== "HYPERDRIVE") errors.push("The active Hyperdrive binding must be named HYPERDRIVE");
  if (id !== EXPECTED_HYPERDRIVE_ID) {
    errors.push(`Hyperdrive ID must be ${EXPECTED_HYPERDRIVE_ID}`);
  }
}

const connectionStringIndex = workerEntry.indexOf("env?.HYPERDRIVE?.connectionString");
const databaseAssignmentIndex = workerEntry.indexOf("process.env.DATABASE_URL = connectionString");
const workerFetchIndex = workerEntry.indexOf("worker.fetch");
if (connectionStringIndex === -1 || databaseAssignmentIndex === -1 || workerFetchIndex === -1) {
  errors.push("worker-entry.mjs must apply the Hyperdrive connection string before worker.fetch");
} else if (databaseAssignmentIndex > workerFetchIndex) {
  errors.push("worker-entry.mjs applies Hyperdrive after worker.fetch; database access can race the binding setup");
}

requireMatch(deployWorkflow, /^concurrency:\s*$/m, "Production deployment workflow must define concurrency");
requireMatch(deployWorkflow, /cancel-in-progress:\s*false/, "Production deployments must not cancel an in-progress deployment");
requireMatch(deployWorkflow, /wrangler deploy/, "Production deployment workflow must contain the deploy command");
requireMatch(deployWorkflow, /wrangler deploy --secrets-file/, "Production deployment must upload code and secrets in one Wrangler operation");
requireMatch(deployWorkflow, /cf:verify-live/, "Production deployment must verify the active Worker version after upload");
requireMatch(deployWorkflow, /cf:types:check/, "Production deployment must verify generated Cloudflare types");
if (/wrangler secret bulk/.test(deployWorkflow)) {
  errors.push("Production deployment must not create a second version through wrangler secret bulk");
}

try {
  const packageJson = JSON.parse(packageJsonText);
  const wranglerVersion = packageJson.devDependencies?.wrangler ?? packageJson.dependencies?.wrangler;
  if (!wranglerVersion || !/^\^?4(?:\.|$)/.test(wranglerVersion)) {
    errors.push("Wrangler 4 is required for atomic --secrets-file deployment");
  }
} catch (error) {
  errors.push(`package.json is not valid JSON: ${error.message}`);
}

if (process.argv.includes("--production") && currentBranch() !== EXPECTED_BRANCH) {
  errors.push(`Production deployment must run from ${EXPECTED_BRANCH}; current branch is ${currentBranch() || "detached/unknown"}`);
}

scanTrackedCredentialUris();

if (errors.length > 0) {
  console.error("Cloudflare production configuration validation failed:");
  for (const error of [...new Set(errors)]) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Cloudflare production configuration is valid for ${EXPECTED_WORKER}.`);
console.log(`Verified active Hyperdrive binding ${EXPECTED_HYPERDRIVE_ID}.`);
console.log(`Repository root: ${relative(process.cwd(), ROOT) || "."}`);
