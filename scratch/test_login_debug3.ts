import { chromium } from "playwright";
const BASE_URL = "http://localhost:3000";
async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "load", timeout: 60000 });
  await page.fill('input[name="email"]', "admin@talentos.local");
  await page.fill('input[name="password"]', "AdminPass123!");
  await page.click('button[type="submit"]');
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000);
    if (page.url() !== `${BASE_URL}/login`) break;
  }
  console.log("URL:", page.url());
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
