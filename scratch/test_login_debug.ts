import { chromium } from "playwright";
const BASE_URL = "http://localhost:3000";
async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.fill('input[name="email"]', "admin@talentos.local");
  await page.fill('input[name="password"]', "AdminPass123!");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
  console.log("URL after submit:", page.url());
  const bodyText = await page.locator("body").innerText();
  console.log("Body text (first 800 chars):", bodyText.slice(0, 800));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
