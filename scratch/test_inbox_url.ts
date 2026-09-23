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
  console.log("post-login URL:", page.url());

  const resp = await page.goto(`${BASE_URL}/inbox`, { waitUntil: "load", timeout: 60000 });
  console.log("goto(/inbox) response status:", resp?.status(), "final URL right after goto:", page.url());
  await page.waitForTimeout(3000);
  console.log("URL after 3s settle:", page.url());
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
