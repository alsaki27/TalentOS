import { chromium } from "playwright";
const BASE_URL = "http://localhost:3000";
async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 60000 });
  await page.fill('input[name="email"]', "admin@talentos.local");
  await page.fill('input[name="password"]', "AdminPass123!");
  await page.click('button[type="submit"]');
  for (let i = 0; i < 40 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);

  for (const qs of ["relevant=true", "clearanceOnly=true", "relevant=false"]) {
    const res = await context.request.get(`${BASE_URL}/api/gmail-communications?direction=inbox&${qs}`, { timeout: 40000 });
    const body = await res.text();
    console.log(`${qs} -> HTTP ${res.status()}`, res.ok() ? `(total=${JSON.parse(body).total})` : body.slice(0, 300));
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
