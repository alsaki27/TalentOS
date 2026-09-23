const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const WORKER_NAME = process.env.CLOUDFLARE_WORKER_NAME || "skarion-talent-os";
const EXPECTED_HYPERDRIVE_ID = "30402bc671364a7686899a2bec4befb1";
const EXPECTED_SHA = process.env.GITHUB_SHA;

if (!ACCOUNT_ID || !API_TOKEN) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
}
if (!EXPECTED_SHA) throw new Error("GITHUB_SHA is required to identify the deployment");

async function cloudflare(path, query) {
  const url = new URL(`https://api.cloudflare.com/client/v4${path}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      Accept: "application/json",
    },
  });
  const body = await response.json();
  if (!response.ok || !body.success) {
    const detail = body.errors?.map((error) => error.message).join("; ") || response.statusText;
    throw new Error(`Cloudflare API request failed (${response.status}): ${detail}`);
  }
  return body.result;
}

const basePath = `/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER_NAME}`;
const deployments = await cloudflare(`${basePath}/deployments`, { per_page: 20 });
const activeDeployments = (deployments.deployments || []).filter((deployment) =>
  deployment.versions?.some((version) => version.percentage === 100),
);
const latest = activeDeployments[0];
if (!latest) throw new Error("No active 100% Worker deployment was returned");

const activeVersion = latest.versions.find((version) => version.percentage === 100);
const version = await cloudflare(`${basePath}/versions/${activeVersion.version_id}`);
const message = latest.annotations?.["workers/message"] || version.annotations?.["workers/message"] || "";
if (!message.includes(EXPECTED_SHA)) {
  throw new Error(`Active deployment ${latest.id} is not tagged with commit ${EXPECTED_SHA}`);
}

const hyperdriveBindings = (version.resources?.bindings || []).filter(
  (binding) => binding.name === "HYPERDRIVE" && binding.type === "hyperdrive",
);
if (hyperdriveBindings.length !== 1 || hyperdriveBindings[0].id !== EXPECTED_HYPERDRIVE_ID) {
  throw new Error(
    `Active version ${version.id} does not contain exactly the approved HYPERDRIVE binding`,
  );
}

console.log(`Verified Worker ${WORKER_NAME}.`);
console.log(`Verified active deployment ${latest.id} at 100%.`);
console.log(`Verified active version ${version.id} for commit ${EXPECTED_SHA}.`);
console.log(`Verified HYPERDRIVE ${EXPECTED_HYPERDRIVE_ID}.`);
