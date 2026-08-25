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

  const t0 = Date.now();
  const res = await context.request.get(`${BASE_URL}/api/candidates?compact=1&pageSize=200`, { timeout: 40000 });
  console.log(`Authed /api/candidates: HTTP ${res.status()} in ${Date.now() - t0}ms`);
  const body = await res.text();
  console.log("body (first 400 chars):", body.slice(0, 400));

  // Now watch console errors on the actual /inbox page load.
  page.on("console", (msg) => { if (msg.type() === "error") console.log("[console error]", msg.text().slice(0, 200)); });
  page.on("pageerror", (err) => console.log("[page error]", err.message.slice(0, 300)));
  await page.goto(`${BASE_URL}/inbox`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(8000);
  console.log("URL now:", page.url());
  const gmailSelect = page.locator("select").filter({ has: page.locator('option:has-text("Select client candidate")') });
  const optTexts = await gmailSelect.locator("option").allTextContents();
  console.log("Gmail selector options after 8s:", optTexts.slice(0, 6), `(total ${optTexts.length})`);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
