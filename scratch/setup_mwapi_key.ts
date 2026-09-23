// One-shot setup: creates the mwapi.dev Anthropic-compatible key and routes
// application_resume_forge to it as primary, preserving existing fallbacks.
// Never logs the raw key value.
import { chromium } from "playwright";
const BASE_URL = "http://localhost:3000";
const RAW_KEY = "sk-8d93daf176120224019f094af52fac08db632a6e7f26b6b430cd36243125e2a1";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 90000 });
  await page.fill('input[name="email"]', "admin@talentos.local");
  await page.fill('input[name="password"]', "AdminPass123!");
  await page.click('button[type="submit"]');
  for (let i = 0; i < 60 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);

  // 1. Create the key.
  const createRes = await context.request.post(`${BASE_URL}/api/admin/ai/keys`, {
    data: {
      provider: "anthropic",
      label: "MWAPI Anthropic Proxy (Resume Forge)",
      apiKey: RAW_KEY,
      model: "claude-sonnet-5",
      base_url: "https://api.mwapi.dev",
      chat_endpoint: "/v1/messages",
      provider_mode: "anthropic_compatible",
      api_style: "anthropic_messages",
      priority: 50,
      isEnabled: true,
    },
    timeout: 40000,
  });
  const createData = await createRes.json();
  console.log("Create key status:", createRes.status());
  console.log("Key id:", createData.key?.id, "| fingerprint:", createData.key?.key_fingerprint, "| label:", createData.key?.label);
  console.log("Live test result:", JSON.stringify(createData.test));
  console.log("Auto-enabled:", createData.autoEnabled);

  if (!createRes.ok() || !createData.key?.id) {
    console.log("ABORTING — key creation failed, not touching routes.");
    await browser.close();
    return;
  }
  const newKeyId = createData.key.id as string;

  // 2. Fetch current routes for application_resume_forge.
  const routesGetRes = await context.request.get(`${BASE_URL}/api/admin/ai/agents/application_resume_forge/routes`, { timeout: 30000 });
  const routesData = await routesGetRes.json();
  const existing: any[] = routesData.routes ?? [];
  console.log(`\nExisting resume-forge routes (${existing.length}):`, existing.map((r) => ({ key: r.ai_key_id, rank: r.rank, model: r.model_override })));

  // 3. Put the new key as rank 1, shift existing routes down, preserve their model_override.
  const newRoutes = [
    { ai_key_id: newKeyId, model_override: "claude-sonnet-5", rank: 1 },
    ...existing
      .sort((a, b) => a.rank - b.rank)
      .map((r, i) => ({ ai_key_id: r.ai_key_id, model_override: r.model_override, rank: i + 2 })),
  ];

  const putRes = await context.request.put(`${BASE_URL}/api/admin/ai/agents/application_resume_forge/routes`, {
    data: { routes: newRoutes, routeVersion: routesData.routeVersion },
    timeout: 30000,
  });
  const putData = await putRes.json();
  console.log("\nRoute update status:", putRes.status());
  console.log("New routeVersion:", putData.routeVersion);
  console.log("Warnings:", putData.warnings);
  console.log("Final routes:", (putData.routes ?? []).map((r: any) => ({ rank: r.rank, key: r.key_label, model: r.model_override })));

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
