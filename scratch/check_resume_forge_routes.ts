import { chromium } from "playwright";
const BASE_URL = "http://localhost:3000";
async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 90000 });
  await page.fill('input[name="email"]', "admin@talentos.local");
  await page.fill('input[name="password"]', "AdminPass123!");
  await page.click('button[type="submit"]');
  for (let i = 0; i < 60 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);

  const res = await context.request.get(`${BASE_URL}/api/admin/ai/agents/application_resume_forge/routes`, { timeout: 30000 });
  console.log("Status:", res.status());
  console.log(await res.text());

  const keysRes = await context.request.get(`${BASE_URL}/api/admin/ai/keys`, { timeout: 30000 });
  const keysData = await keysRes.json();
  console.log("\nExisting keys (id, provider, label, model, enabled):");
  for (const k of keysData.keys ?? []) {
    console.log(` - ${k.id} | ${k.provider} | ${k.label} | model=${k.model} | enabled=${k.is_enabled}`);
  }

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
